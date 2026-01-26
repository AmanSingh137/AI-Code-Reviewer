# AI Code Reviewer - VS Code Extension

An AI-powered VS Code extension that analyzes your codebase using local Ollama models to provide feedback on best practices, security vulnerabilities, and improvement suggestions.

## Features

- 🤖 **AI-Powered Analysis**: Uses local Ollama models for code analysis (no data sent to external servers)
- 🔒 **Security Scanning**: Identifies security vulnerabilities and provides remediation suggestions
- ✨ **Best Practices**: Highlights code quality issues and suggests improvements
- 📊 **Comprehensive Feedback**: Provides detailed analysis with code examples and explanations
- 🎯 **File & Workspace Analysis**: Analyze individual files or entire workspaces
- ⚙️ **Configurable**: Customize Ollama URL, model, and file patterns

## Prerequisites

1. **Ollama**: Install and run Ollama locally
   - Download from: https://ollama.ai
   - Install a model: `ollama pull llama3.2` (or your preferred model)

2. **VS Code**: Version 1.74.0 or higher

## Installation

1. Clone or download this repository
2. Open the project folder in VS Code
3. Install dependencies:
   ```bash
   npm install
   ```
4. Compile the extension:
   ```bash
   npm run compile
   ```
5. Press `F5` to launch a new Extension Development Host window
6. In the new window, use the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:
   - `AI Code Reviewer: Analyze Current File`
   - `AI Code Reviewer: Analyze Workspace`

## Configuration

Open VS Code settings and search for "AI Code Reviewer" or edit `settings.json`:

```json
{
  "aiCodeReviewer.ollamaUrl": "http://localhost:11434",
  "aiCodeReviewer.model": "llama3.2",
  "aiCodeReviewer.maxFileSize": 100000,
  "aiCodeReviewer.includePatterns": [
    "**/*.ts",
    "**/*.js",
    "**/*.py",
    "**/*.java"
  ],
  "aiCodeReviewer.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**"
  ]
}
```

### Configuration Options

- **ollamaUrl**: The URL where Ollama API is running (default: `http://localhost:11434`)
- **model**: The Ollama model to use for analysis (default: `llama3.2`)
- **maxFileSize**: Maximum file size in bytes to analyze (default: 100000)
- **includePatterns**: File patterns to include in workspace analysis
- **excludePatterns**: File patterns to exclude from analysis

## Usage

### Analyze Current File

1. Open a code file in VS Code
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "AI Code Reviewer: Analyze Current File"
4. Wait for analysis to complete
5. Review results in the feedback panel

### Analyze Workspace

1. Open a workspace folder in VS Code
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "AI Code Reviewer: Analyze Workspace"
4. Confirm the analysis (it may take a while for large codebases)
5. Review results in the feedback panel

### Configure Ollama Settings

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "AI Code Reviewer: Configure Ollama Settings"
3. Enter your Ollama URL and model name

## How It Works

1. **Code Collection**: The extension scans your codebase based on configured patterns
2. **AI Analysis**: Code is sent to your local Ollama instance for analysis
3. **Feedback Generation**: Ollama analyzes the code for:
   - Security vulnerabilities (SQL injection, XSS, authentication issues, etc.)
   - Performance bottlenecks
   - Code maintainability and readability
   - Architecture and design patterns
   - Error handling
   - Resource management
   - Best practices
4. **Results Display**: Analysis results are displayed in a webview panel with:
   - Summary of findings
   - Best practices identified
   - Vulnerabilities with severity levels
   - Improvement suggestions with code examples

## Supported Languages

The extension can analyze code in multiple languages:
- TypeScript/JavaScript (.ts, .js, .tsx, .jsx)
- Python (.py)
- Java (.java)
- C/C++ (.c, .cpp)
- Go (.go)
- Rust (.rs)
- And more (configurable via patterns)

## Troubleshooting

### Cannot connect to Ollama

- Ensure Ollama is running: `ollama serve` or check if it's running as a service
- Verify the Ollama URL in settings matches your Ollama instance
- Check if the model is installed: `ollama list`

### Analysis takes too long

- Reduce the number of files by adjusting `includePatterns` and `excludePatterns`
- Increase `maxFileSize` to skip very large files
- Use a faster/smaller Ollama model

### No results displayed

- Check the VS Code Output panel for error messages
- Ensure the Ollama model supports JSON output
- Try analyzing a smaller file first

## Development

### Project Structure

```
.
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── types.ts              # TypeScript type definitions
│   ├── services/
│   │   ├── ollamaService.ts  # Ollama API integration
│   │   └── codeAnalyzer.ts   # Code analysis logic
│   └── panels/
│       └── feedbackPanel.ts  # UI panel for displaying results
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

### Building

```bash
npm install
npm run compile
```

### Debugging

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. Set breakpoints in the code
4. Use the debug console to inspect variables

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Built with [VS Code Extension API](https://code.visualstudio.com/api)
- Powered by [Ollama](https://ollama.ai)


