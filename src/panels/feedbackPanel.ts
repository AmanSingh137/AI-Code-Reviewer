import * as vscode from 'vscode';
import { AnalysisResult } from '../types';
import * as path from 'path';

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

  public displayResults(results: AnalysisResult | AnalysisResult[]) {
    const isArray = Array.isArray(results);
    const resultsArray = isArray ? results : [results];
    
    this._panel.webview.html = this.getWebviewContent(resultsArray, isArray);
  }

  private getWebviewContent(results: AnalysisResult[], isWorkspace: boolean): string {
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
    const scoringSummaryHtml = this.renderScoringSummary(results);

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
  <title>AI Code Review Results</title>
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
    <h1>🤖 AI Code Review Results</h1>
    <p>${isWorkspace ? `Analyzed ${results.length} file(s)` : 'Single file analysis'}</p>
  </div>
  ${scoringSummaryHtml}
  ${renderResults}
</body>
</html>`;
  }

  private renderScoringSummary(results: AnalysisResult[]): string {
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


