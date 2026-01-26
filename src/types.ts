export interface RubricScore {
  rubric: 'security' | 'performance' | 'readability' | 'maintainability';
  score: number; // 1-10
  aiScore?: number; // AI-provided score
  calculatedScore?: number; // Rule-based calculated score
}

export interface ScoringSummary {
  security: number;
  performance: number;
  readability: number;
  maintainability: number;
  rubricScores: RubricScore[];
}

export interface AnalysisResult {
  filePath: string;
  bestPractices: string[];
  vulnerabilities: Vulnerability[];
  improvements: Improvement[];
  summary: string;
  scores?: ScoringSummary;
}

export interface Vulnerability {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  line?: number;
  codeSnippet?: string;
  recommendation: string;
}

export interface Improvement {
  category: 'performance' | 'readability' | 'maintainability' | 'security' | 'architecture';
  description: string;
  line?: number;
  currentCode?: string;
  suggestedCode?: string;
  explanation: string;
}

export interface OllamaConfig {
  url: string;
  model: string;
}


