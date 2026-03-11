import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaService } from './ollamaService';
import { AnalysisResult, Vulnerability, Improvement, ScoringSummary, RubricScore, ComparisonResult, ArchitectureImpact } from '../types';

export class CodeAnalyzer {
  private ollamaService: OllamaService;
  private maxFileSize: number;
  private includePatterns: string[];
  private excludePatterns: string[];

  constructor(
    ollamaService: OllamaService,
    maxFileSize: number,
    includePatterns: string[],
    excludePatterns: string[]
  ) {
    this.ollamaService = ollamaService;
    this.maxFileSize = maxFileSize;
    this.includePatterns = includePatterns;
    this.excludePatterns = excludePatterns;
  }

  async analyzeFile(filePath: string): Promise<AnalysisResult> {
    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      const code = document.getText();
      const language = document.languageId;

      if (code.length > this.maxFileSize) {
        throw new Error(`File is too large (${code.length} bytes). Maximum size is ${this.maxFileSize} bytes.`);
      }

      const analysisText = await this.ollamaService.analyzeCode(code, filePath, language);
      return this.parseAnalysisResponse(analysisText, filePath);
    } catch (error: any) {
      throw new Error(`Failed to analyze file ${filePath}: ${error.message}`);
    }
  }

  async analyzeWorkspace(workspaceFolder: vscode.WorkspaceFolder): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];
    const files = await this.findCodeFiles(workspaceFolder.uri.fsPath);

    const progressOptions: vscode.ProgressOptions = {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing workspace",
      cancellable: true
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) {
          break;
        }

        const file = files[i];
        progress.report({
          increment: (100 / files.length),
          message: `Analyzing ${path.basename(file)} (${i + 1}/${files.length})`
        });

        try {
          const result = await this.analyzeFile(file);
          results.push(result);
        } catch (error: any) {
          vscode.window.showWarningMessage(`Skipped ${file}: ${error.message}`);
        }
      }
    });

    return results;
  }

  async analyzeFolder(folderPath: string): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];
    const files = await this.findCodeFiles(folderPath);

    const progressOptions: vscode.ProgressOptions = {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing folder",
      cancellable: true
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) {
          break;
        }

        const file = files[i];
        progress.report({
          increment: (100 / files.length),
          message: `Analyzing ${path.basename(file)} (${i + 1}/${files.length})`
        });

        try {
          const result = await this.analyzeFile(file);
          results.push(result);
        } catch (error: any) {
          vscode.window.showWarningMessage(`Skipped ${file}: ${error.message}`);
        }
      }
    });

    return results;
  }

  private async findCodeFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    const includeGlobs = this.includePatterns.map(pattern => 
      new vscode.RelativePattern(rootPath, pattern)
    );
    const excludeGlobs = this.excludePatterns.map(pattern => 
      new vscode.RelativePattern(rootPath, pattern)
    );

    for (const includeGlob of includeGlobs) {
      const foundFiles = await vscode.workspace.findFiles(includeGlob, 
        `{${excludeGlobs.map(g => g.pattern).join(',')}}`
      );
      files.push(...foundFiles.map(f => f.fsPath));
    }

    // Remove duplicates
    return [...new Set(files)];
  }

  private parseAnalysisResponse(response: string, filePath: string): AnalysisResult {
    try {
      // Remove markdown code block markers (```json, ```, etc.)
      let cleanedResponse = response.trim();
      
      // Remove opening code block markers (```json, ```, etc.) - handle various formats
      cleanedResponse = cleanedResponse.replace(/^```(?:json|JSON)?\s*\n?/i, '');
      
      // Remove closing code block markers - handle various positions
      cleanedResponse = cleanedResponse.replace(/\n?```\s*$/i, '');
      cleanedResponse = cleanedResponse.replace(/```\s*$/i, '');
      
      // Clean up any remaining whitespace
      cleanedResponse = cleanedResponse.trim();
      
      // Try to extract JSON from the response (in case there's extra text)
      // First, try to find the JSON object boundaries
      const firstBrace = cleanedResponse.indexOf('{');
      if (firstBrace === -1) {
        throw new Error('No JSON object found in response');
      }

      // Extract from first brace onwards
      let jsonCandidate = cleanedResponse.substring(firstBrace);
      
      // Check if response might be truncated (doesn't end with } or ])
      const trimmedCandidate = jsonCandidate.trim();
      const mightBeTruncated = !trimmedCandidate.endsWith('}') && !trimmedCandidate.endsWith(']');
      
      // Try to fix incomplete JSON by finding balanced braces
      jsonCandidate = this.fixIncompleteJson(jsonCandidate);
      
      // Parse the JSON
      let parsed: any;
      try {
        parsed = JSON.parse(jsonCandidate);
      } catch (parseError: any) {
        // If parsing fails and response might be truncated, throw a more specific error
        if (mightBeTruncated) {
          throw new Error('Response appears to be truncated. Attempting to extract partial data...');
        }
        throw parseError;
      }
      
      const result: AnalysisResult = {
        filePath: filePath,
        summary: parsed.summary || 'No summary provided',
        bestPractices: Array.isArray(parsed.bestPractices) ? parsed.bestPractices : [],
        vulnerabilities: this.parseVulnerabilities(parsed.vulnerabilities || []),
        improvements: this.parseImprovements(parsed.improvements || [])
      };

      // Parse and calculate scores
      const aiScores = this.parseAIScores(parsed.scores);
      const calculatedScores = this.calculateRuleBasedScores(result);
      result.scores = this.validateAndMergeScores(aiScores, calculatedScores);

      return result;
    } catch (error: any) {
      // Fallback: try to extract partial data from incomplete JSON
      const partialResult = this.tryExtractPartialJson(response, filePath);
      if (partialResult) {
        return partialResult;
      }
      
      // Final fallback: return a structured response even if parsing fails
      const fallbackResult: AnalysisResult = {
        filePath: filePath,
        summary: 'Failed to parse analysis response. Raw response: ' + response.substring(0, 500),
        bestPractices: [],
        vulnerabilities: [],
        improvements: []
      };

      // Calculate rule-based scores as fallback
      const calculatedScores = this.calculateRuleBasedScores(fallbackResult);
      fallbackResult.scores = this.validateAndMergeScores(null, calculatedScores);

      return fallbackResult;
    }
  }

  private fixIncompleteJson(jsonString: string): string {
    // Count opening and closing braces/brackets
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escapeNext = false;
    let lastChar = '';
    
    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];
      lastChar = char;
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (inString) {
        continue;
      }
      
      if (char === '{') {
        openBraces++;
      } else if (char === '}') {
        openBraces--;
      } else if (char === '[') {
        openBrackets++;
      } else if (char === ']') {
        openBrackets--;
      }
    }
    
    // Build the fixed JSON
    let fixed = jsonString;
    
    // If we're still in a string, close it first
    if (inString) {
      // Find the last quote position and close the string
      // If we're in a string, we need to close it
      fixed += '"';
    }
    
    // If the last character before truncation suggests an incomplete property,
    // we need to handle it. Check if we need to close a property value
    if (lastChar && !inString) {
      // If the string ends with a comma or colon, we might need to add a placeholder
      const trimmed = fixed.trim();
      if (trimmed.endsWith(',') || trimmed.endsWith(':')) {
        // This is tricky - we don't know what type of value was expected
        // For now, we'll just close the brackets/braces and hope JSON.parse can handle it
        // or we'll add null as a placeholder
        if (trimmed.endsWith(':')) {
          fixed += ' null';
        }
      }
    }
    
    // Add missing closing brackets/braces (brackets first, then braces)
    while (openBrackets > 0) {
      fixed += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      fixed += '}';
      openBraces--;
    }
    
    return fixed;
  }

  private tryExtractPartialJson(response: string, filePath: string): AnalysisResult | null {
    try {
      // Remove markdown code block markers first
      let cleanedResponse = response.trim();
      cleanedResponse = cleanedResponse.replace(/^```(?:json|JSON)?\s*\n?/i, '');
      cleanedResponse = cleanedResponse.replace(/\n?```\s*$/i, '');
      cleanedResponse = cleanedResponse.replace(/```\s*$/i, '');
      cleanedResponse = cleanedResponse.trim();
      
      // Try to extract what we can from incomplete JSON
      const firstBrace = cleanedResponse.indexOf('{');
      if (firstBrace === -1) {
        return null;
      }
      
      let jsonCandidate = cleanedResponse.substring(firstBrace);
      jsonCandidate = this.fixIncompleteJson(jsonCandidate);
      
      // Try parsing the fixed JSON
      try {
        const parsed = JSON.parse(jsonCandidate);
        const result: AnalysisResult = {
          filePath: filePath,
          summary: parsed.summary || 'Partial analysis (response was incomplete)',
          bestPractices: Array.isArray(parsed.bestPractices) ? parsed.bestPractices : [],
          vulnerabilities: this.parseVulnerabilities(parsed.vulnerabilities || []),
          improvements: this.parseImprovements(parsed.improvements || [])
        };

        // Parse and calculate scores
        const aiScores = this.parseAIScores(parsed.scores);
        const calculatedScores = this.calculateRuleBasedScores(result);
        result.scores = this.validateAndMergeScores(aiScores, calculatedScores);

        return result;
      } catch (parseError) {
        // If parsing still fails, try to extract fields using regex
        return this.extractFieldsWithRegex(cleanedResponse, filePath);
      }
    } catch {
      return null;
    }
  }

  private extractFieldsWithRegex(jsonString: string, filePath: string): AnalysisResult | null {
    try {
      const result: Partial<AnalysisResult> = {
        filePath: filePath,
        summary: '',
        bestPractices: [],
        vulnerabilities: [],
        improvements: []
      };

      // Extract summary
      const summaryMatch = jsonString.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
      if (summaryMatch) {
        result.summary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') || 'Partial analysis (response was incomplete)';
      } else {
        // Try to get summary even if string is incomplete
        const summaryPartialMatch = jsonString.match(/"summary"\s*:\s*"([^"]*)/);
        if (summaryPartialMatch) {
          result.summary = summaryPartialMatch[1] + '... (truncated)';
        } else {
          result.summary = 'Partial analysis (response was incomplete)';
        }
      }

      // Extract bestPractices array
      const bestPracticesMatch = jsonString.match(/"bestPractices"\s*:\s*\[(.*?)\]/s);
      if (bestPracticesMatch) {
        const practicesContent = bestPracticesMatch[1];
        const practiceMatches = practicesContent.matchAll(/"([^"]*(?:\\.[^"]*)*)"/g);
        result.bestPractices = Array.from(practiceMatches, m => m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
      }

      // Extract vulnerabilities (simplified - just get what we can)
      const vulnerabilitiesMatch = jsonString.match(/"vulnerabilities"\s*:\s*\[(.*?)(?:\]|$)/s);
      if (vulnerabilitiesMatch) {
        const vulnsContent = vulnerabilitiesMatch[1];
        const vulns: any[] = [];
        
        // Try to extract vulnerability objects more flexibly
        // Look for patterns like "severity": "..." even in incomplete objects
        let currentPos = 0;
        while (currentPos < vulnsContent.length) {
          const nextBrace = vulnsContent.indexOf('{', currentPos);
          if (nextBrace === -1) break;
          
          // Find the end of this object (next } or end of string)
          let braceCount = 0;
          let inString = false;
          let escapeNext = false;
          let objEnd = nextBrace + 1;
          
          for (let i = nextBrace; i < vulnsContent.length; i++) {
            const char = vulnsContent[i];
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            if (char === '"' && !escapeNext) {
              inString = !inString;
              continue;
            }
            if (!inString) {
              if (char === '{') braceCount++;
              if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                  objEnd = i + 1;
                  break;
                }
              }
            }
          }
          
          const vulnStr = vulnsContent.substring(nextBrace, objEnd);
          const severityMatch = vulnStr.match(/"severity"\s*:\s*"([^"]+)"/);
          const descMatch = vulnStr.match(/"description"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
          const lineMatch = vulnStr.match(/"line"\s*:\s*(\d+)/);
          const codeMatch = vulnStr.match(/"codeSnippet"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
          const recMatch = vulnStr.match(/"recommendation"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
          
          // Also try to get incomplete strings
          const descPartialMatch = !descMatch ? vulnStr.match(/"description"\s*:\s*"([^"]*)/) : null;
          const codePartialMatch = !codeMatch ? vulnStr.match(/"codeSnippet"\s*:\s*"([^"]*)/) : null;
          const recPartialMatch = !recMatch ? vulnStr.match(/"recommendation"\s*:\s*"([^"]*)/) : null;
          
          if (descMatch || descPartialMatch || severityMatch) {
            vulns.push({
              severity: severityMatch ? severityMatch[1] : 'medium',
              description: descMatch ? descMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : 
                          descPartialMatch ? descPartialMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') + '... (truncated)' : 'No description',
              line: lineMatch ? parseInt(lineMatch[1]) : undefined,
              codeSnippet: codeMatch ? codeMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : 
                          codePartialMatch ? codePartialMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') + '... (truncated)' : undefined,
              recommendation: recMatch ? recMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : 
                             recPartialMatch ? recPartialMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') + '... (truncated)' : 'No recommendation'
            });
          }
          
          currentPos = objEnd;
        }
        
        result.vulnerabilities = this.parseVulnerabilities(vulns);
      }

      // Extract improvements (similar approach)
      const improvementsMatch = jsonString.match(/"improvements"\s*:\s*\[(.*?)(?:\]|$)/s);
      if (improvementsMatch) {
        const impsContent = improvementsMatch[1];
        const impMatches = impsContent.matchAll(/\{([^}]*)\}/g);
        const imps: any[] = [];
        for (const match of impMatches) {
          const impStr = match[1];
          const catMatch = impStr.match(/"category"\s*:\s*"([^"]+)"/);
          const descMatch = impStr.match(/"description"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
          const lineMatch = impStr.match(/"line"\s*:\s*(\d+)/);
          const explMatch = impStr.match(/"explanation"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
          
          if (descMatch || catMatch) {
            imps.push({
              category: catMatch ? catMatch[1] : 'maintainability',
              description: descMatch ? descMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : 'No description',
              line: lineMatch ? parseInt(lineMatch[1]) : undefined,
              explanation: explMatch ? explMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : 'No explanation'
            });
          }
        }
        result.improvements = this.parseImprovements(imps);
      }

      const analysisResult: AnalysisResult = {
        filePath: result.filePath || filePath,
        summary: result.summary || 'Partial analysis (response was incomplete)',
        bestPractices: result.bestPractices || [],
        vulnerabilities: result.vulnerabilities || [],
        improvements: result.improvements || []
      };

      // Calculate rule-based scores as fallback
      const calculatedScores = this.calculateRuleBasedScores(analysisResult);
      analysisResult.scores = this.validateAndMergeScores(null, calculatedScores);

      return analysisResult;
    } catch {
      return null;
    }
  }

  private parseVulnerabilities(vulns: any[]): Vulnerability[] {
    return vulns.map(v => ({
      severity: this.parseSeverity(v.severity),
      description: v.description || 'No description',
      line: v.line,
      codeSnippet: v.codeSnippet,
      recommendation: v.recommendation || 'No recommendation'
    }));
  }

  private parseImprovements(improvements: any[]): Improvement[] {
    return improvements.map(i => ({
      category: this.parseCategory(i.category),
      description: i.description || 'No description',
      line: i.line,
      currentCode: i.currentCode,
      suggestedCode: i.suggestedCode,
      explanation: i.explanation || 'No explanation'
    }));
  }

  private parseSeverity(severity: any): 'low' | 'medium' | 'high' | 'critical' {
    const s = String(severity).toLowerCase();
    if (['low', 'medium', 'high', 'critical'].includes(s)) {
      return s as 'low' | 'medium' | 'high' | 'critical';
    }
    return 'medium';
  }

  private parseCategory(category: any): 'performance' | 'readability' | 'maintainability' | 'security' | 'architecture' {
    const c = String(category).toLowerCase();
    if (['performance', 'readability', 'maintainability', 'security', 'architecture'].includes(c)) {
      return c as 'performance' | 'readability' | 'maintainability' | 'security' | 'architecture';
    }
    return 'maintainability';
  }

  private parseAIScores(scores: any): ScoringSummary | null {
    if (!scores || typeof scores !== 'object') {
      return null;
    }

    const security = this.clampScore(scores.security);
    const performance = this.clampScore(scores.performance);
    const readability = this.clampScore(scores.readability);
    const maintainability = this.clampScore(scores.maintainability);

    return {
      security: security || 5,
      performance: performance || 5,
      readability: readability || 5,
      maintainability: maintainability || 5,
      rubricScores: [
        { rubric: 'security', score: security || 5, aiScore: security },
        { rubric: 'performance', score: performance || 5, aiScore: performance },
        { rubric: 'readability', score: readability || 5, aiScore: readability },
        { rubric: 'maintainability', score: maintainability || 5, aiScore: maintainability }
      ]
    };
  }

  private clampScore(score: any): number | undefined {
    if (typeof score !== 'number') {
      return undefined;
    }
    return Math.max(1, Math.min(10, Math.round(score)));
  }

  private calculateRuleBasedScores(result: AnalysisResult): ScoringSummary {
    // Calculate Security Score based on vulnerabilities
    let securityScore = 10;
    const criticalCount = result.vulnerabilities.filter(v => v.severity === 'critical').length;
    const highCount = result.vulnerabilities.filter(v => v.severity === 'high').length;
    const mediumCount = result.vulnerabilities.filter(v => v.severity === 'medium').length;
    const lowCount = result.vulnerabilities.filter(v => v.severity === 'low').length;

    securityScore = securityScore - (criticalCount * 3 + highCount * 2 + mediumCount * 1 + lowCount * 0.5);
    securityScore = Math.max(1, Math.min(10, Math.round(securityScore * 10) / 10));

    // Calculate Performance Score based on performance improvements
    const performanceImprovements = result.improvements.filter(i => i.category === 'performance').length;
    let performanceScore = 10 - (performanceImprovements * 0.8);
    performanceScore = Math.max(1, Math.min(10, Math.round(performanceScore * 10) / 10));

    // Calculate Readability Score based on readability improvements
    const readabilityImprovements = result.improvements.filter(i => i.category === 'readability').length;
    let readabilityScore = 10 - (readabilityImprovements * 0.7);
    readabilityScore = Math.max(1, Math.min(10, Math.round(readabilityScore * 10) / 10));

    // Calculate Maintainability Score based on maintainability improvements
    const maintainabilityImprovements = result.improvements.filter(i => i.category === 'maintainability').length;
    let maintainabilityScore = 10 - (maintainabilityImprovements * 0.7);
    maintainabilityScore = Math.max(1, Math.min(10, Math.round(maintainabilityScore * 10) / 10));

    return {
      security: securityScore,
      performance: performanceScore,
      readability: readabilityScore,
      maintainability: maintainabilityScore,
      rubricScores: [
        { rubric: 'security', score: securityScore, calculatedScore: securityScore },
        { rubric: 'performance', score: performanceScore, calculatedScore: performanceScore },
        { rubric: 'readability', score: readabilityScore, calculatedScore: readabilityScore },
        { rubric: 'maintainability', score: maintainabilityScore, calculatedScore: maintainabilityScore }
      ]
    };
  }

  private validateAndMergeScores(aiScores: ScoringSummary | null, calculatedScores: ScoringSummary): ScoringSummary {
    if (!aiScores) {
      // If no AI scores, use calculated scores
      return calculatedScores;
    }

    // Merge AI scores with calculated scores
    // Use AI scores as primary, but validate against calculated scores
    const mergedScores: ScoringSummary = {
      security: aiScores.security,
      performance: aiScores.performance,
      readability: aiScores.readability,
      maintainability: aiScores.maintainability,
      rubricScores: aiScores.rubricScores.map(aiRubric => {
        const calculatedRubric = calculatedScores.rubricScores.find(r => r.rubric === aiRubric.rubric);
        return {
          rubric: aiRubric.rubric,
          score: aiRubric.score,
          aiScore: aiRubric.aiScore,
          calculatedScore: calculatedRubric?.calculatedScore
        };
      })
    };

    return mergedScores;
  }

  async analyzeDiff(
    diff: string,
    changedFiles: string[],
    relatedFiles: string[],
    filePath: string = 'diff'
  ): Promise<AnalysisResult> {
    try {
      const analysisText = await this.ollamaService.analyzeDiff(diff, changedFiles);
      return this.parseAnalysisResponse(analysisText, filePath);
    } catch (error: any) {
      throw new Error(`Failed to analyze diff: ${error.message}`);
    }
  }

  async analyzeArchitectureImpact(
    changedFiles: string[],
    relatedFiles: string[],
    diff: string
  ): Promise<ArchitectureImpact> {
    try {
      const analysisText = await this.ollamaService.analyzeArchitectureImpact(changedFiles, relatedFiles, diff);
      return this.parseArchitectureImpactResponse(analysisText);
    } catch (error: any) {
      // Fallback to default architecture impact
      return {
        summary: 'Unable to analyze architecture impact: ' + error.message,
        affectedComponents: changedFiles,
        breakingChanges: [],
        dependencyChanges: [],
        riskLevel: 'medium'
      };
    }
  }

  private parseArchitectureImpactResponse(response: string): ArchitectureImpact {
    try {
      // Remove markdown code block markers
      let cleanedResponse = response.trim();
      cleanedResponse = cleanedResponse.replace(/^```(?:json|JSON)?\s*\n?/i, '');
      cleanedResponse = cleanedResponse.replace(/\n?```\s*$/i, '');
      cleanedResponse = cleanedResponse.trim();

      // Extract JSON
      const firstBrace = cleanedResponse.indexOf('{');
      if (firstBrace === -1) {
        throw new Error('No JSON object found in response');
      }

      let jsonCandidate = cleanedResponse.substring(firstBrace);
      jsonCandidate = this.fixIncompleteJson(jsonCandidate);

      const parsed = JSON.parse(jsonCandidate);

      return {
        summary: parsed.summary || 'No summary provided',
        affectedComponents: Array.isArray(parsed.affectedComponents) ? parsed.affectedComponents : [],
        breakingChanges: Array.isArray(parsed.breakingChanges) ? parsed.breakingChanges : [],
        dependencyChanges: Array.isArray(parsed.dependencyChanges) ? parsed.dependencyChanges : [],
        riskLevel: this.parseRiskLevel(parsed.riskLevel)
      };
    } catch (error: any) {
      // Fallback
      return {
        summary: 'Failed to parse architecture impact analysis: ' + error.message,
        affectedComponents: [],
        breakingChanges: [],
        dependencyChanges: [],
        riskLevel: 'medium'
      };
    }
  }

  private parseRiskLevel(riskLevel: any): 'low' | 'medium' | 'high' {
    const r = String(riskLevel).toLowerCase();
    if (['low', 'medium', 'high'].includes(r)) {
      return r as 'low' | 'medium' | 'high';
    }
    return 'medium';
  }

  async findRelatedFiles(changedFiles: string[]): Promise<string[]> {
    const relatedFiles = new Set<string>();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Read all code files to find imports/exports
    const allCodeFiles = await this.findCodeFiles(workspaceRoot);
    const importMap = new Map<string, Set<string>>(); // file -> set of imported files
    const exportMap = new Map<string, Set<string>>(); // file -> set of files that import it

    // Build import/export maps
    for (const file of allCodeFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const code = document.getText();
        const imports = this.extractImports(code, file);
        
        importMap.set(file, new Set(imports));
        for (const importedFile of imports) {
          if (!exportMap.has(importedFile)) {
            exportMap.set(importedFile, new Set());
          }
          exportMap.get(importedFile)!.add(file);
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    // Find related files
    for (const changedFile of changedFiles) {
      // Files that import the changed file
      const importingFiles = exportMap.get(changedFile);
      if (importingFiles) {
        importingFiles.forEach(f => relatedFiles.add(f));
      }

      // Files that the changed file imports
      const importedFiles = importMap.get(changedFile);
      if (importedFiles) {
        importedFiles.forEach(f => relatedFiles.add(f));
      }
    }

    // Remove changed files from related files
    changedFiles.forEach(f => relatedFiles.delete(f));

    return Array.from(relatedFiles);
  }

  private extractImports(code: string, filePath: string): string[] {
    const imports: string[] = [];
    const lines = code.split('\n');
    const fileDir = path.dirname(filePath);
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || '';

    // Common import patterns
    const importPatterns = [
      // ES6/TypeScript: import ... from '...'
      /import\s+.*?\s+from\s+['"](.+?)['"]/g,
      // CommonJS: require('...')
      /require\s*\(\s*['"](.+?)['"]\s*\)/g,
      // Python: import ... or from ... import
      /(?:^|\s)(?:import|from)\s+['"]?([^'"\s]+)['"]?/g,
      // Go: import "..."
      /import\s+['"](.+?)['"]/g,
    ];

    for (const line of lines) {
      for (const pattern of importPatterns) {
        const matches = line.matchAll(pattern);
        for (const match of matches) {
          if (match[1]) {
            const importPath = match[1];
            // Resolve relative imports
            const resolvedPath = this.resolveImportPath(importPath, fileDir, workspaceRoot);
            if (resolvedPath && fs.existsSync(resolvedPath)) {
              imports.push(resolvedPath);
            }
          }
        }
      }
    }

    return imports;
  }

  private resolveImportPath(importPath: string, fileDir: string, workspaceRoot: string): string | null {
    // Skip node_modules and external packages
    if (importPath.startsWith('node_modules/') || !importPath.startsWith('.')) {
      // Try to resolve as relative to workspace
      const possiblePaths = [
        path.join(workspaceRoot, importPath),
        path.join(workspaceRoot, importPath + '.ts'),
        path.join(workspaceRoot, importPath + '.js'),
        path.join(workspaceRoot, importPath + '.tsx'),
        path.join(workspaceRoot, importPath + '.jsx'),
        path.join(fileDir, importPath),
        path.join(fileDir, importPath + '.ts'),
        path.join(fileDir, importPath + '.js'),
        path.join(fileDir, importPath + '.tsx'),
        path.join(fileDir, importPath + '.jsx'),
      ];

      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          return possiblePath;
        }
      }
    } else {
      // Relative import
      const possiblePaths = [
        path.join(fileDir, importPath),
        path.join(fileDir, importPath + '.ts'),
        path.join(fileDir, importPath + '.js'),
        path.join(fileDir, importPath + '.tsx'),
        path.join(fileDir, importPath + '.jsx'),
        path.join(fileDir, importPath, 'index.ts'),
        path.join(fileDir, importPath, 'index.js'),
      ];

      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          return possiblePath;
        }
      }
    }

    return null;
  }
}


