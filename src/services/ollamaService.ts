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

  updateConfig(config: OllamaConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url,
      timeout: 300000,
    });
  }
}


