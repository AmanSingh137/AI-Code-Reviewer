import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { OllamaConfig } from '../types';

export class OllamaService {
  private client: AxiosInstance;
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url,
      timeout: 300000, // 5 minutes timeout for large codebases
    });
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/tags');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async analyzeCode(code: string, filePath: string, language?: string): Promise<string> {
    const prompt = this.buildAnalysisPrompt(code, filePath, language);
    
    try {
      const response = await this.client.post('/api/generate', {
        model: this.config.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
        }
      });

      return response.data.response || '';
    } catch (error: any) {
      if (error.response) {
        throw new Error(`Ollama API error: ${error.response.status} - ${error.response.data?.error || error.message}`);
      } else if (error.request) {
        throw new Error('Cannot connect to Ollama. Please ensure Ollama is running and the URL is correct.');
      } else {
        throw new Error(`Error analyzing code: ${error.message}`);
      }
    }
  }

  private buildAnalysisPrompt(code: string, filePath: string, language?: string): string {
    const langContext = language ? `Language: ${language}\n` : '';
    
    return `You are an expert code reviewer analyzing code for best practices, security vulnerabilities, and improvement opportunities.

${langContext}File: ${filePath}

Code to analyze:
\`\`\`
${code}
\`\`\`

Please provide a comprehensive code review in the following JSON format:
{
  "summary": "Brief overall assessment of the code",
  "bestPractices": [
    "List of best practices being followed or should be followed"
  ],
  "vulnerabilities": [
    {
      "severity": "low|medium|high|critical",
      "description": "Description of the vulnerability",
      "line": line_number,
      "codeSnippet": "relevant code snippet",
      "recommendation": "How to fix it"
    }
  ],
  "improvements": [
    {
      "category": "performance|readability|maintainability|security|architecture",
      "description": "What can be improved",
      "line": line_number,
      "currentCode": "current implementation",
      "suggestedCode": "improved implementation",
      "explanation": "Why this improvement helps"
    }
  ],
  "scores": {
    "security": 1-10,
    "performance": 1-10,
    "readability": 1-10,
    "maintainability": 1-10
  }
}

Scoring Guidelines (1-10 scale):
- Security: 9-10 = No vulnerabilities, 7-8 = Only low severity, 5-6 = Medium severity present, 3-4 = High severity present, 1-2 = Critical vulnerabilities
- Performance: 9-10 = No performance issues, 7-8 = Minor optimizations needed, 5-6 = Some performance concerns, 3-4 = Significant performance issues, 1-2 = Major performance problems
- Readability: 9-10 = Excellent code clarity, 7-8 = Good with minor improvements, 5-6 = Acceptable but could be clearer, 3-4 = Hard to read, 1-2 = Very difficult to understand
- Maintainability: 9-10 = Easy to maintain and extend, 7-8 = Generally maintainable, 5-6 = Some maintainability concerns, 3-4 = Difficult to maintain, 1-2 = Very difficult to maintain

Focus on:
1. Security vulnerabilities (SQL injection, XSS, authentication issues, etc.)
2. Performance bottlenecks
3. Code maintainability and readability
4. Architecture and design patterns
5. Error handling
6. Resource management
7. Best practices for the programming language

Return ONLY valid JSON, no markdown formatting or additional text.`;
  }

  async analyzeDiff(diff: string, changedFiles: string[]): Promise<string> {
    const prompt = this.buildDiffAnalysisPrompt(diff, changedFiles);
    
    try {
      const response = await this.client.post('/api/generate', {
        model: this.config.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
        }
      });

      return response.data.response || '';
    } catch (error: any) {
      if (error.response) {
        throw new Error(`Ollama API error: ${error.response.status} - ${error.response.data?.error || error.message}`);
      } else if (error.request) {
        throw new Error('Cannot connect to Ollama. Please ensure Ollama is running and the URL is correct.');
      } else {
        throw new Error(`Error analyzing diff: ${error.message}`);
      }
    }
  }

  async analyzeArchitectureImpact(changedFiles: string[], relatedFiles: string[], diff: string): Promise<string> {
    const prompt = this.buildArchitectureImpactPrompt(changedFiles, relatedFiles, diff);
    
    try {
      const response = await this.client.post('/api/generate', {
        model: this.config.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
        }
      });

      return response.data.response || '';
    } catch (error: any) {
      if (error.response) {
        throw new Error(`Ollama API error: ${error.response.status} - ${error.response.data?.error || error.message}`);
      } else if (error.request) {
        throw new Error('Cannot connect to Ollama. Please ensure Ollama is running and the URL is correct.');
      } else {
        throw new Error(`Error analyzing architecture impact: ${error.message}`);
      }
    }
  }

  private buildDiffAnalysisPrompt(diff: string, changedFiles: string[]): string {
    const filesList = changedFiles.map(f => `- ${f}`).join('\n');
    
    return `You are an expert code reviewer analyzing git diff changes for best practices, security vulnerabilities, and improvement opportunities.

Changed Files:
${filesList}

Git Diff:
\`\`\`
${diff}
\`\`\`

Please provide a comprehensive code review of the changes in the following JSON format:
{
  "summary": "Brief overall assessment of the changes",
  "bestPractices": [
    "List of best practices being followed or should be followed in the changes"
  ],
  "vulnerabilities": [
    {
      "severity": "low|medium|high|critical",
      "description": "Description of the vulnerability introduced or fixed",
      "line": line_number,
      "codeSnippet": "relevant code snippet from diff",
      "recommendation": "How to fix it"
    }
  ],
  "improvements": [
    {
      "category": "performance|readability|maintainability|security|architecture",
      "description": "What can be improved in the changes",
      "line": line_number,
      "currentCode": "current implementation from diff",
      "suggestedCode": "improved implementation",
      "explanation": "Why this improvement helps"
    }
  ],
  "scores": {
    "security": 1-10,
    "performance": 1-10,
    "readability": 1-10,
    "maintainability": 1-10
  }
}

Scoring Guidelines (1-10 scale):
- Security: 9-10 = No vulnerabilities, 7-8 = Only low severity, 5-6 = Medium severity present, 3-4 = High severity present, 1-2 = Critical vulnerabilities
- Performance: 9-10 = No performance issues, 7-8 = Minor optimizations needed, 5-6 = Some performance concerns, 3-4 = Significant performance issues, 1-2 = Major performance problems
- Readability: 9-10 = Excellent code clarity, 7-8 = Good with minor improvements, 5-6 = Acceptable but could be clearer, 3-4 = Hard to read, 1-2 = Very difficult to understand
- Maintainability: 9-10 = Easy to maintain and extend, 7-8 = Generally maintainable, 5-6 = Some maintainability concerns, 3-4 = Difficult to maintain, 1-2 = Very difficult to maintain

Focus on:
1. Changes that introduce or fix security vulnerabilities
2. Performance implications of the changes
3. Code maintainability and readability improvements or regressions
4. Architecture and design pattern changes
5. Error handling changes
6. Resource management changes
7. Breaking changes or backward compatibility issues

Return ONLY valid JSON, no markdown formatting or additional text.`;
  }

  private buildArchitectureImpactPrompt(changedFiles: string[], relatedFiles: string[], diff: string): string {
    const changedFilesList = changedFiles.map(f => `- ${f}`).join('\n');
    const relatedFilesList = relatedFiles.length > 0 
      ? relatedFiles.map(f => `- ${f}`).join('\n')
      : 'None identified';
    
    return `You are an expert software architect analyzing how code changes affect the overall system architecture.

Changed Files:
${changedFilesList}

Related Files (files that import or are imported by changed files):
${relatedFilesList}

Git Diff:
\`\`\`
${diff.substring(0, 5000)}
\`\`\`

Please analyze the architectural impact of these changes and provide your assessment in the following JSON format:
{
  "summary": "Brief summary of how these changes affect the architecture",
  "affectedComponents": [
    "List of components, modules, or subsystems affected by these changes"
  ],
  "breakingChanges": [
    "List of any breaking changes that could affect other parts of the system"
  ],
  "dependencyChanges": [
    "List of changes to dependencies, imports, or interfaces"
  ],
  "riskLevel": "low|medium|high"
}

Risk Level Guidelines:
- "low": Changes are isolated, well-contained, and unlikely to affect other components
- "medium": Changes affect multiple components but are backward compatible
- "high": Changes introduce breaking changes, affect core architecture, or significantly alter system behavior

Focus on:
1. Component boundaries and module dependencies
2. Interface changes (function signatures, class structures, API contracts)
3. Data flow and state management changes
4. Integration points with other systems
5. Scalability and performance implications
6. Maintainability and extensibility impacts

Return ONLY valid JSON, no markdown formatting or additional text.`;
  }

  updateConfig(config: OllamaConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url,
      timeout: 300000,
    });
  }
}


