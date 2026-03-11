import * as vscode from 'vscode';
import { AnalysisResult, ComparisonResult } from '../types';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import axios from 'axios';

interface Scores {
  security: number;
  maintainability: number;
  performance: number;
  readability: number;
}
export class FeedbackPanel {
  private static currentPanel: FeedbackPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri): FeedbackPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (FeedbackPanel.currentPanel) {
      FeedbackPanel.currentPanel._panel.reveal(column);
      return FeedbackPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiCodeReviewer',
      'AI Code Review Results',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    FeedbackPanel.currentPanel = new FeedbackPanel(panel);
    return FeedbackPanel.currentPanel;
  }

  public async displayResults(results: AnalysisResult | AnalysisResult[] | ComparisonResult) {
    // Check if it's a ComparisonResult
    if (!Array.isArray(results) && 'baseCommitHash' in results) {
      this._panel.title = 'Commit Comparison Results';
      this._panel.webview.html = await this.getComparisonWebviewContent(results);
      return;
    }

    const isArray = Array.isArray(results);
    const resultsArray = isArray ? results : [results];
    
    this._panel.webview.html = await this.getWebviewContent(resultsArray, isArray);
  }

  private async getWebviewContent(results: AnalysisResult[], isWorkspace: boolean): Promise<string> {
    const severityColors: Record<string, string> = {
      low: '#4CAF50',
      medium: '#FF9800',
      high: '#F44336',
      critical: '#9C27B0'
    };

    const categoryColors: Record<string, string> = {
      performance: '#2196F3',
      readability: '#00BCD4',
      maintainability: '#9C27B0',
      security: '#F44336',
      architecture: '#FF9800'
    };

    // Calculate average scores for workspace analysis
    const scoringSummaryHtml = await this.renderScoringSummary(results);

    const renderResults = results.map(result => {
      const fileName = path.basename(result.filePath);
      const fileDir = path.dirname(result.filePath);

      const vulnerabilitiesHtml = result.vulnerabilities.length > 0
        ? `
          <div class="section">
            <h3>🔒 Vulnerabilities (${result.vulnerabilities.length})</h3>
            ${result.vulnerabilities.map(vuln => `
              <div class="vulnerability" data-severity="${vuln.severity}">
                <div class="severity-badge" style="background-color: ${severityColors[vuln.severity]}">
                  ${vuln.severity.toUpperCase()}
                </div>
                <div class="content">
                  <p><strong>${vuln.description}</strong></p>
                  ${vuln.line ? `<p class="line-info">Line ${vuln.line}</p>` : ''}
                  ${vuln.codeSnippet ? `<pre><code>${this.escapeHtml(vuln.codeSnippet)}</code></pre>` : ''}
                  <p class="recommendation">💡 <strong>Recommendation:</strong> ${vuln.recommendation}</p>
                </div>
              </div>
            `).join('')}
          </div>
        `
        : '<div class="section"><p class="no-issues">✅ No vulnerabilities found</p></div>';

      const improvementsHtml = result.improvements.length > 0
        ? `
          <div class="section">
            <h3>✨ Improvements (${result.improvements.length})</h3>
            ${result.improvements.map(imp => `
              <div class="improvement" data-category="${imp.category}">
                <div class="category-badge" style="background-color: ${categoryColors[imp.category]}">
                  ${imp.category}
                </div>
                <div class="content">
                  <p><strong>${imp.description}</strong></p>
                  ${imp.line ? `<p class="line-info">Line ${imp.line}</p>` : ''}
                  ${imp.explanation ? `<p>${imp.explanation}</p>` : ''}
                  ${imp.currentCode && imp.suggestedCode ? `
                    <div class="code-comparison">
                      <div class="code-block">
                        <h4>Current:</h4>
                        <pre><code>${this.escapeHtml(imp.currentCode)}</code></pre>
                      </div>
                      <div class="code-block">
                        <h4>Suggested:</h4>
                        <pre><code>${this.escapeHtml(imp.suggestedCode)}</code></pre>
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `
        : '<div class="section"><p class="no-issues">✅ No improvements suggested</p></div>';

      return `
        <div class="file-result">
          <div class="file-header">
            <h2>📄 ${this.escapeHtml(fileName)}</h2>
            <p class="file-path">${this.escapeHtml(fileDir)}</p>
          </div>
          <div class="summary">
            <p>${this.escapeHtml(result.summary)}</p>
          </div>
          ${result.bestPractices.length > 0 ? `
            <div class="section">
              <h3>✅ Best Practices</h3>
              <ul>
                ${result.bestPractices.map(bp => `<li>${this.escapeHtml(bp)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${vulnerabilitiesHtml}
          ${improvementsHtml}
        </div>
      `;
    }).join('<hr class="file-separator">');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>REFINE: Code Review Results</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      padding: 20px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      line-height: 1.6;
    }
    .header {
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid var(--vscode-panel-border);
    }
    .header h1 {
      margin: 0;
      color: var(--vscode-textLink-foreground);
    }
    .file-result {
      margin-bottom: 40px;
      padding: 20px;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
    }
    .file-header h2 {
      margin: 0 0 5px 0;
      color: var(--vscode-textLink-foreground);
    }
    .file-path {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin: 0;
    }
    .summary {
      margin: 20px 0;
      padding: 15px;
      background-color: var(--vscode-textBlockQuote-background);
      border-left: 4px solid var(--vscode-textLink-foreground);
      border-radius: 4px;
    }
    .section {
      margin: 25px 0;
    }
    .section h3 {
      margin-bottom: 15px;
      color: var(--vscode-textLink-foreground);
    }
    .vulnerability, .improvement {
      margin: 15px 0;
      padding: 15px;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      border-left: 4px solid;
    }
    .vulnerability[data-severity="critical"] {
      border-left-color: #9C27B0;
    }
    .vulnerability[data-severity="high"] {
      border-left-color: #F44336;
    }
    .vulnerability[data-severity="medium"] {
      border-left-color: #FF9800;
    }
    .vulnerability[data-severity="low"] {
      border-left-color: #4CAF50;
    }
    .severity-badge, .category-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      color: white;
      font-size: 0.75em;
      font-weight: bold;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    .line-info {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin: 5px 0;
    }
    .recommendation {
      margin-top: 10px;
      padding: 10px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
    }
    pre {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 10px 0;
    }
    code {
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    .code-comparison {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin: 15px 0;
    }
    .code-block h4 {
      margin: 0 0 10px 0;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .no-issues {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    ul {
      margin: 10px 0;
      padding-left: 25px;
    }
    li {
      margin: 5px 0;
    }
    .file-separator {
      margin: 40px 0;
      border: none;
      border-top: 2px solid var(--vscode-panel-border);
    }
    .scoring-summary {
      margin-bottom: 30px;
      padding: 20px;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
    }
    .scoring-summary h2 {
      margin: 0 0 20px 0;
      color: var(--vscode-textLink-foreground);
    }
    .score-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .score-card {
      padding: 15px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 6px;
      border-left: 4px solid;
    }
    .score-card h3 {
      margin: 0 0 10px 0;
      font-size: 0.9em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    .score-value {
      font-size: 2em;
      font-weight: bold;
      margin: 10px 0;
    }
    .score-bar {
      width: 100%;
      height: 8px;
      background-color: var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 10px;
    }
    .score-bar-fill {
      height: 100%;
      transition: width 0.3s ease;
    }
    .score-card[data-rubric="security"] {
      border-left-color: #F44336;
    }
    .score-card[data-rubric="performance"] {
      border-left-color: #2196F3;
    }
    .score-card[data-rubric="readability"] {
      border-left-color: #00BCD4;
    }
    .score-card[data-rubric="maintainability"] {
      border-left-color: #9C27B0;
    }
    .score-value[data-score-range="low"] {
      color: #F44336;
    }
    .score-value[data-score-range="medium"] {
      color: #FF9800;
    }
    .score-value[data-score-range="good"] {
      color: #FFC107;
    }
    .score-value[data-score-range="excellent"] {
      color: #4CAF50;
    }
    @media (max-width: 768px) {
      .code-comparison {
        grid-template-columns: 1fr;
      }
      .score-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 REFINE: Review Results</h1>
    <p>${isWorkspace ? `Analyzed ${results.length} file(s)` : 'Single file analysis'}</p>
  </div>
  ${scoringSummaryHtml}
  ${renderResults}
</body>
</html>`;
  }


  // private async isMainBranch(): Promise<boolean> {
  //   const git: SimpleGit = simpleGit();
  //   try{
  //   let branch = await git.branch();
  //   return branch.current === 'main';
  //   } catch(err) {
  //     console.log(err);
  //   }
  //   return false;
  // }

  // private async postReview(scores: Scores): Promise<void> {
  //   try {
  //     const response = await axios.post('http://localhost:3000/reviews', {
  //       security_score: scores.security,
  //       maintainability_score: scores.maintainability,
  //       performance_score: scores.performance,
  //       readability_score: scores.readability,
  //       review_time: new Date()
  //     }, {
  //       headers: { 'Content-Type': 'application/json' }
  //     });
  //     console.log('POST response:', response.data);
  //   } catch (err: any) {
  //     console.error('Error posting review:', err?.message || err);
  //   }
  // }

  private async renderScoringSummary(results: AnalysisResult[]): Promise<string> {
    // Calculate average scores across all files
    const validResults = results.filter(r => r.scores);
    if (validResults.length === 0) {
      return '';
    }

    const avgScores = {
      security: 0,
      performance: 0,
      readability: 0,
      maintainability: 0
    };

    validResults.forEach(result => {
      if (result.scores) {
        avgScores.security += result.scores.security;
        avgScores.performance += result.scores.performance;
        avgScores.readability += result.scores.readability;
        avgScores.maintainability += result.scores.maintainability;
      }
    });

    const count = validResults.length;
    avgScores.security = Math.round((avgScores.security / count) * 10) / 10;
    avgScores.performance = Math.round((avgScores.performance / count) * 10) / 10;
    avgScores.readability = Math.round((avgScores.readability / count) * 10) / 10;
    avgScores.maintainability = Math.round((avgScores.maintainability / count) * 10) / 10;

    // if (await this.isMainBranch()) {
    //   await this.postReview(avgScores);
    //   console.log("review posted");
    // } 

    const getScoreRange = (score: number): string => {
      if (score >= 9) return 'excellent';
      if (score >= 7) return 'good';
      if (score >= 4) return 'medium';
      return 'low';
    };

    const getScoreColor = (score: number): string => {
      if (score >= 9) return '#4CAF50';
      if (score >= 7) return '#FFC107';
      if (score >= 4) return '#FF9800';
      return '#F44336';
    };

    const rubrics = [
      { key: 'security', label: 'Security', score: avgScores.security },
      { key: 'performance', label: 'Performance', score: avgScores.performance },
      { key: 'readability', label: 'Readability', score: avgScores.readability },
      { key: 'maintainability', label: 'Maintainability', score: avgScores.maintainability }
    ];

    const scoreCards = rubrics.map(rubric => {
      const range = getScoreRange(rubric.score);
      const color = getScoreColor(rubric.score);
      return `
        <div class="score-card" data-rubric="${rubric.key}">
          <h3>${rubric.label}</h3>
          <div class="score-value" data-score-range="${range}">${rubric.score.toFixed(1)}</div>
          <div class="score-bar">
            <div class="score-bar-fill" style="width: ${(rubric.score / 10) * 100}%; background-color: ${color};"></div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="scoring-summary">
        <h2>📊 Code Quality Scores</h2>
        <div class="score-grid">
          ${scoreCards}
        </div>
      </div>
    `;
  }

  private async getComparisonWebviewContent(result: ComparisonResult): Promise<string> {
    const severityColors: Record<string, string> = {
      low: '#4CAF50',
      medium: '#FF9800',
      high: '#F44336',
      critical: '#9C27B0'
    };

    const categoryColors: Record<string, string> = {
      performance: '#2196F3',
      readability: '#00BCD4',
      maintainability: '#9C27B0',
      security: '#F44336',
      architecture: '#FF9800'
    };

    const riskColors: Record<string, string> = {
      low: '#4CAF50',
      medium: '#FF9800',
      high: '#F44336'
    };

    const scoringSummaryHtml = await this.renderScoringSummary([result]);
    
    const commitInfoHtml = `
      <div class="commit-info">
        <h2>📋 Commit Comparison</h2>
        <div class="commit-details">
          <p><strong>Base Commit:</strong> <code>${result.baseCommitHash.substring(0, 7)}</code></p>
          <p><strong>Message:</strong> ${this.escapeHtml(result.baseCommitInfo.message)}</p>
          <p><strong>Author:</strong> ${this.escapeHtml(result.baseCommitInfo.author)}</p>
          <p><strong>Date:</strong> ${this.escapeHtml(result.baseCommitInfo.date)}</p>
          <p><strong>Comparison Type:</strong> ${result.comparisonType === 'working-dir' ? 'Working Directory' : 'HEAD Commit'}</p>
        </div>
      </div>
    `;

    const changedFilesHtml = `
      <div class="section">
        <h3>📝 Changed Files (${result.changedFiles.length})</h3>
        <ul class="file-list">
          ${result.changedFiles.map(file => {
            const fileName = path.basename(file);
            const fileDir = path.dirname(file);
            return `<li><strong>${this.escapeHtml(fileName)}</strong> <span class="file-path">${this.escapeHtml(fileDir)}</span></li>`;
          }).join('')}
        </ul>
      </div>
    `;

    const architectureImpactHtml = `
      <div class="section">
        <h3>🏗️ Architecture Impact</h3>
        <div class="architecture-impact" data-risk="${result.architectureImpact.riskLevel}">
          <div class="risk-badge" style="background-color: ${riskColors[result.architectureImpact.riskLevel]}">
            ${result.architectureImpact.riskLevel.toUpperCase()} RISK
          </div>
          <div class="content">
            <p><strong>Summary:</strong> ${this.escapeHtml(result.architectureImpact.summary)}</p>
            
            ${result.architectureImpact.affectedComponents.length > 0 ? `
              <div class="impact-list">
                <h4>Affected Components:</h4>
                <ul>
                  ${result.architectureImpact.affectedComponents.map(comp => `<li>${this.escapeHtml(comp)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            
            ${result.architectureImpact.breakingChanges.length > 0 ? `
              <div class="impact-list breaking">
                <h4>⚠️ Breaking Changes:</h4>
                <ul>
                  ${result.architectureImpact.breakingChanges.map(change => `<li>${this.escapeHtml(change)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            
            ${result.architectureImpact.dependencyChanges.length > 0 ? `
              <div class="impact-list">
                <h4>Dependency Changes:</h4>
                <ul>
                  ${result.architectureImpact.dependencyChanges.map(dep => `<li>${this.escapeHtml(dep)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    const vulnerabilitiesHtml = result.vulnerabilities.length > 0
      ? `
        <div class="section">
          <h3>🔒 Vulnerabilities (${result.vulnerabilities.length})</h3>
          ${result.vulnerabilities.map(vuln => `
            <div class="vulnerability" data-severity="${vuln.severity}">
              <div class="severity-badge" style="background-color: ${severityColors[vuln.severity]}">
                ${vuln.severity.toUpperCase()}
              </div>
              <div class="content">
                <p><strong>${vuln.description}</strong></p>
                ${vuln.line ? `<p class="line-info">Line ${vuln.line}</p>` : ''}
                ${vuln.codeSnippet ? `<pre><code>${this.escapeHtml(vuln.codeSnippet)}</code></pre>` : ''}
                <p class="recommendation">💡 <strong>Recommendation:</strong> ${vuln.recommendation}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `
      : '<div class="section"><p class="no-issues">✅ No vulnerabilities found</p></div>';

    const improvementsHtml = result.improvements.length > 0
      ? `
        <div class="section">
          <h3>✨ Improvements (${result.improvements.length})</h3>
          ${result.improvements.map(imp => `
            <div class="improvement" data-category="${imp.category}">
              <div class="category-badge" style="background-color: ${categoryColors[imp.category]}">
                ${imp.category}
              </div>
              <div class="content">
                <p><strong>${imp.description}</strong></p>
                ${imp.line ? `<p class="line-info">Line ${imp.line}</p>` : ''}
                ${imp.explanation ? `<p>${imp.explanation}</p>` : ''}
                ${imp.currentCode && imp.suggestedCode ? `
                  <div class="code-comparison">
                    <div class="code-block">
                      <h4>Current:</h4>
                      <pre><code>${this.escapeHtml(imp.currentCode)}</code></pre>
                    </div>
                    <div class="code-block">
                      <h4>Suggested:</h4>
                      <pre><code>${this.escapeHtml(imp.suggestedCode)}</code></pre>
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `
      : '<div class="section"><p class="no-issues">✅ No improvements suggested</p></div>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Commit Comparison Results</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      padding: 20px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      line-height: 1.6;
    }
    .header {
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid var(--vscode-panel-border);
    }
    .header h1 {
      margin: 0;
      color: var(--vscode-textLink-foreground);
    }
    .commit-info {
      margin-bottom: 30px;
      padding: 20px;
      background-color: var(--vscode-textBlockQuote-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
    }
    .commit-info h2 {
      margin: 0 0 15px 0;
      color: var(--vscode-textLink-foreground);
    }
    .commit-details p {
      margin: 8px 0;
    }
    .commit-details code {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    .section {
      margin: 25px 0;
    }
    .section h3 {
      margin-bottom: 15px;
      color: var(--vscode-textLink-foreground);
    }
    .file-list {
      list-style: none;
      padding: 0;
    }
    .file-list li {
      padding: 8px;
      margin: 5px 0;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
    }
    .file-list .file-path {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-left: 10px;
    }
    .architecture-impact {
      margin: 15px 0;
      padding: 15px;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      border-left: 4px solid;
    }
    .architecture-impact[data-risk="high"] {
      border-left-color: #F44336;
    }
    .architecture-impact[data-risk="medium"] {
      border-left-color: #FF9800;
    }
    .architecture-impact[data-risk="low"] {
      border-left-color: #4CAF50;
    }
    .risk-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      color: white;
      font-size: 0.75em;
      font-weight: bold;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    .impact-list {
      margin: 15px 0;
      padding: 10px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
    }
    .impact-list.breaking {
      border-left: 3px solid #F44336;
    }
    .impact-list h4 {
      margin: 0 0 10px 0;
      font-size: 0.9em;
    }
    .impact-list ul {
      margin: 5px 0;
      padding-left: 25px;
    }
    .vulnerability, .improvement {
      margin: 15px 0;
      padding: 15px;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      border-left: 4px solid;
    }
    .vulnerability[data-severity="critical"] {
      border-left-color: #9C27B0;
    }
    .vulnerability[data-severity="high"] {
      border-left-color: #F44336;
    }
    .vulnerability[data-severity="medium"] {
      border-left-color: #FF9800;
    }
    .vulnerability[data-severity="low"] {
      border-left-color: #4CAF50;
    }
    .severity-badge, .category-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      color: white;
      font-size: 0.75em;
      font-weight: bold;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    .line-info {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin: 5px 0;
    }
    .recommendation {
      margin-top: 10px;
      padding: 10px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
    }
    pre {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 10px 0;
    }
    code {
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    .code-comparison {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin: 15px 0;
    }
    .code-block h4 {
      margin: 0 0 10px 0;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .no-issues {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .summary {
      margin: 20px 0;
      padding: 15px;
      background-color: var(--vscode-textBlockQuote-background);
      border-left: 4px solid var(--vscode-textLink-foreground);
      border-radius: 4px;
    }
    .scoring-summary {
      margin-bottom: 30px;
      padding: 20px;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
    }
    .scoring-summary h2 {
      margin: 0 0 20px 0;
      color: var(--vscode-textLink-foreground);
    }
    .score-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .score-card {
      padding: 15px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 6px;
      border-left: 4px solid;
    }
    .score-card h3 {
      margin: 0 0 10px 0;
      font-size: 0.9em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    .score-value {
      font-size: 2em;
      font-weight: bold;
      margin: 10px 0;
    }
    .score-bar {
      width: 100%;
      height: 8px;
      background-color: var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 10px;
    }
    .score-bar-fill {
      height: 100%;
      transition: width 0.3s ease;
    }
    .score-card[data-rubric="security"] {
      border-left-color: #F44336;
    }
    .score-card[data-rubric="performance"] {
      border-left-color: #2196F3;
    }
    .score-card[data-rubric="readability"] {
      border-left-color: #00BCD4;
    }
    .score-card[data-rubric="maintainability"] {
      border-left-color: #9C27B0;
    }
    .score-value[data-score-range="low"] {
      color: #F44336;
    }
    .score-value[data-score-range="medium"] {
      color: #FF9800;
    }
    .score-value[data-score-range="good"] {
      color: #FFC107;
    }
    .score-value[data-score-range="excellent"] {
      color: #4CAF50;
    }
    @media (max-width: 768px) {
      .code-comparison {
        grid-template-columns: 1fr;
      }
      .score-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔄 Commit Comparison Results</h1>
  </div>
  ${scoringSummaryHtml}
  ${commitInfoHtml}
  ${changedFilesHtml}
  ${architectureImpactHtml}
  <div class="summary">
    <p>${this.escapeHtml(result.summary)}</p>
  </div>
  ${result.bestPractices.length > 0 ? `
    <div class="section">
      <h3>✅ Best Practices</h3>
      <ul>
        ${result.bestPractices.map(bp => `<li>${this.escapeHtml(bp)}</li>`).join('')}
      </ul>
    </div>
  ` : ''}
  ${vulnerabilitiesHtml}
  ${improvementsHtml}
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  public dispose() {
    FeedbackPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}


