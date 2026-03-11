import * as vscode from 'vscode';
import { OllamaService } from './services/ollamaService';
import { CodeAnalyzer } from './services/codeAnalyzer';
import { FeedbackPanel } from './panels/feedbackPanel';
import { GitService } from './services/gitService';
import { ComparisonResult } from './types';

let ollamaService: OllamaService;
let codeAnalyzer: CodeAnalyzer;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  
  // Initialize services with configuration
  initializeServices();

  // Register commands
  const analyzeFileCommand = vscode.commands.registerCommand(
    'aiCodeReviewer.analyzeFile',
    async () => {
      await analyzeCurrentFile();
    }
  );

  const analyzeWorkspaceCommand = vscode.commands.registerCommand(
    'aiCodeReviewer.analyzeWorkspace',
    async () => {
      await analyzeWorkspace();
    }
  );

  const analyzeFolderCommand = vscode.commands.registerCommand(
    'aiCodeReviewer.analyzeFolder',
    async () => {
      await analyzeFolder();
    }
  );

  const configureOllamaCommand = vscode.commands.registerCommand(
    'aiCodeReviewer.configureOllama',
    async () => {
      await configureOllama();
    }
  );

  const compareToCommitCommand = vscode.commands.registerCommand(
    'aiCodeReviewer.compareToCommit',
    async () => {
      await compareToCommit();
    }
  );

  // Listen for configuration changes
  const configWatcher = vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration('aiCodeReviewer')) {
      initializeServices();
      vscode.window.showInformationMessage('REFINE: Configuration updated');
    }
  });

  context.subscriptions.push(
    analyzeFileCommand,
    analyzeWorkspaceCommand,
    analyzeFolderCommand,
    configureOllamaCommand,
    compareToCommitCommand,
    configWatcher
  );
}

function initializeServices() {
  const config = vscode.workspace.getConfiguration('aiCodeReviewer');
  const ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
  const model = config.get<string>('model', 'gpt-oss:20b');
  const maxFileSize = config.get<number>('maxFileSize', 100000);
  
  // Default include patterns (matching package.json defaults)
  const defaultIncludePatterns = [
    '**/*.ts',
    '**/*.js',
    '**/*.tsx',
    '**/*.jsx',
    '**/*.py',
    '**/*.java',
    '**/*.cpp',
    '**/*.c',
    '**/*.go',
    '**/*.rs',
    '**/*.sql'
  ];
  
  const includePatterns = config.get<string[]>('includePatterns', defaultIncludePatterns);
  const excludePatterns = config.get<string[]>('excludePatterns', []);

  ollamaService = new OllamaService({ url: ollamaUrl, model });
  codeAnalyzer = new CodeAnalyzer(ollamaService, maxFileSize, includePatterns, excludePatterns);
}

async function analyzeCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor. Please open a file to analyze.');
    return;
  }

  const filePath = editor.document.uri.fsPath;

  // Check Ollama connection
  const isConnected = await ollamaService.checkConnection();
  if (!isConnected) {
    vscode.window.showErrorMessage(
      'Cannot connect to Ollama. Please ensure Ollama is running and the URL is correct in settings.',
      'Open Settings'
    ).then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aiCodeReviewer');
      }
    });
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing file...',
        cancellable: false
      },
      async () => {
        const result = await codeAnalyzer.analyzeFile(filePath);
        const panel = FeedbackPanel.createOrShow(extensionContext.extensionUri);
        await panel.displayResults(result);
      }
    );
  } catch (error: any) {
    vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
  }
}

async function analyzeWorkspace() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  // Check Ollama connection
  const isConnected = await ollamaService.checkConnection();
  if (!isConnected) {
    vscode.window.showErrorMessage(
      'Cannot connect to Ollama. Please ensure Ollama is running and the URL is correct in settings.',
      'Open Settings'
    ).then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aiCodeReviewer');
      }
    });
    return;
  }

  // Ask user to confirm for workspace analysis
  const confirm = await vscode.window.showWarningMessage(
    'Workspace analysis may take a while and analyze many files. Continue?',
    'Yes',
    'No'
  );

  if (confirm !== 'Yes') {
    return;
  }

  try {
    const results = await codeAnalyzer.analyzeWorkspace(workspaceFolders[0]);
    
    if (results.length === 0) {
      vscode.window.showInformationMessage('No files found to analyze.');
      return;
    }

    const panel = FeedbackPanel.createOrShow(extensionContext.extensionUri);
    await panel.displayResults(results);
    
    vscode.window.showInformationMessage(
      `Analysis complete! Analyzed ${results.length} file(s).`
    );
  } catch (error: any) {
    vscode.window.showErrorMessage(`Workspace analysis failed: ${error.message}`);
  }
}

async function analyzeFolder() {
  // Check Ollama connection
  const isConnected = await ollamaService.checkConnection();
  if (!isConnected) {
    vscode.window.showErrorMessage(
      'Cannot connect to Ollama. Please ensure Ollama is running and the URL is correct in settings.',
      'Open Settings'
    ).then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aiCodeReviewer');
      }
    });
    return;
  }

  // Show folder picker dialog
  const folderUri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Folder to Analyze'
  });

  if (!folderUri || folderUri.length === 0) {
    return;
  }

  const folderPath = folderUri[0].fsPath;

  // Ask user to confirm for folder analysis
  const confirm = await vscode.window.showWarningMessage(
    `Folder analysis may take a while and analyze many files in "${folderPath}". Continue?`,
    'Yes',
    'No'
  );

  if (confirm !== 'Yes') {
    return;
  }

  try {
    const results = await codeAnalyzer.analyzeFolder(folderPath);
    
    if (results.length === 0) {
      vscode.window.showInformationMessage('No files found to analyze in the selected folder.');
      return;
    }

    const panel = FeedbackPanel.createOrShow(extensionContext.extensionUri);
    await panel.displayResults(results);
    
    vscode.window.showInformationMessage(
      `Analysis complete! Analyzed ${results.length} file(s).`
    );
  } catch (error: any) {
    vscode.window.showErrorMessage(`Folder analysis failed: ${error.message}`);
  }
}

async function configureOllama() {
  const config = vscode.workspace.getConfiguration('aiCodeReviewer');
  
  const url = await vscode.window.showInputBox({
    prompt: 'Enter Ollama API URL',
    value: config.get<string>('ollamaUrl', 'http://localhost:11434'),
    placeHolder: 'http://localhost:11434'
  });

  if (url) {
    await config.update('ollamaUrl', url, vscode.ConfigurationTarget.Global);
  }

  const model = await vscode.window.showInputBox({
    prompt: 'Enter Ollama model name',
    value: config.get<string>('model', 'gpt-oss:20b'),
    placeHolder: 'gpt-oss:20b'
  });

  if (model) {
    await config.update('model', model, vscode.ConfigurationTarget.Global);
    initializeServices();
    vscode.window.showInformationMessage('Ollama configuration updated!');
  }
}

async function compareToCommit() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const gitService = new GitService(workspaceRoot);

  // Check if it's a git repository
  const isRepo = await gitService.isRepository();
  if (!isRepo) {
    vscode.window.showErrorMessage('Not a git repository. Please initialize a git repository first.');
    return;
  }

  // Check Ollama connection
  const isConnected = await ollamaService.checkConnection();
  if (!isConnected) {
    vscode.window.showErrorMessage(
      'Cannot connect to Ollama. Please ensure Ollama is running and the URL is correct in settings.',
      'Open Settings'
    ).then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aiCodeReviewer');
      }
    });
    return;
  }

  // Ask user to choose comparison type
  const comparisonType = await vscode.window.showQuickPick(
    [
      { label: 'Compare to Previous Commit', description: 'Compare current changes to the previous commit', value: 'previous' },
      { label: 'Compare to Specific Commit', description: 'Compare to a commit by hash', value: 'specific' }
    ],
    {
      placeHolder: 'Select comparison type'
    }
  );

  if (!comparisonType) {
    return;
  }

  let commitHash: string | null = null;

  if (comparisonType.value === 'previous') {
    commitHash = await gitService.getPreviousCommitHash();
    if (!commitHash) {
      vscode.window.showErrorMessage('No previous commit found. Repository must have at least 2 commits.');
      return;
    }
  } else {
    // Get specific commit hash from user
    const recentCommits = await gitService.getRecentCommits(10);
    const commitOptions = recentCommits.map(commit => ({
      label: commit.hash.substring(0, 7), // Display short hash
      description: commit.message.substring(0, 60),
      detail: `By ${commit.author} on ${commit.date}`,
      value: commit.hash // Store full hash
    }));

    // Add option to enter custom hash
    commitOptions.unshift({
      label: 'Enter commit hash manually',
      description: 'Type a commit hash',
      detail: '',
      value: 'manual'
    });

    const selectedCommit = await vscode.window.showQuickPick(commitOptions, {
      placeHolder: 'Select a commit or enter hash manually'
    });

    if (!selectedCommit) {
      return;
    }

    if (selectedCommit.value === 'manual') {
      const hashInput = await vscode.window.showInputBox({
        prompt: 'Enter commit hash',
        placeHolder: 'e.g., abc1234'
      });

      if (!hashInput) {
        return;
      }

      const isValid = await gitService.validateCommitHash(hashInput);
      if (!isValid) {
        vscode.window.showErrorMessage(`Invalid commit hash: ${hashInput}`);
        return;
      }

      commitHash = hashInput;
    } else {
      commitHash = selectedCommit.value;
    }
  }

  if (!commitHash) {
    return;
  }

  // Ask user to choose comparison scope (working dir vs HEAD)
  const scopeChoice = await vscode.window.showQuickPick(
    [
      { label: 'Working Directory', description: 'Compare uncommitted changes', value: 'working-dir' },
      { label: 'HEAD Commit', description: 'Compare current HEAD commit', value: 'head' }
    ],
    {
      placeHolder: 'Select what to compare'
    }
  );

  if (!scopeChoice) {
    return;
  }

  const comparisonTypeValue = scopeChoice.value as 'working-dir' | 'head';

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Comparing commits...',
        cancellable: false
      },
      async (progress) => {
        progress.report({ increment: 0, message: 'Getting commit information...' });

        // Get commit info
        const commitInfo = await gitService.getCommitInfo(commitHash!);
        
        progress.report({ increment: 20, message: 'Getting diff...' });

        // Get diff
        const diff = await gitService.getDiff(commitHash!, comparisonTypeValue);
        
        if (!diff || diff.trim().length === 0) {
          vscode.window.showInformationMessage('No differences found between the selected commits.');
          return;
        }

        progress.report({ increment: 30, message: 'Extracting changed files...' });

        // Get changed files
        const changedFiles = gitService.getChangedFiles(diff);
        
        if (changedFiles.length === 0) {
          vscode.window.showInformationMessage('No code files changed.');
          return;
        }

        progress.report({ increment: 40, message: 'Finding related files...' });

        // Find related files
        const relatedFiles = await codeAnalyzer.findRelatedFiles(changedFiles);

        progress.report({ increment: 50, message: 'Analyzing diff...' });

        // Analyze diff
        const diffAnalysis = await codeAnalyzer.analyzeDiff(diff, changedFiles, relatedFiles, 'diff');

        progress.report({ increment: 80, message: 'Analyzing architecture impact...' });

        // Analyze architecture impact
        const architectureImpact = await codeAnalyzer.analyzeArchitectureImpact(
          changedFiles,
          relatedFiles,
          diff
        );

        progress.report({ increment: 100, message: 'Complete!' });

        // Create comparison result
        const comparisonResult: ComparisonResult = {
          ...diffAnalysis,
          baseCommitHash: commitHash!,
          baseCommitInfo: commitInfo,
          comparisonType: comparisonTypeValue,
          changedFiles: changedFiles,
          diff: diff,
          architectureImpact: architectureImpact
        };

        const panel = FeedbackPanel.createOrShow(extensionContext.extensionUri);
        await panel.displayResults(comparisonResult);

        vscode.window.showInformationMessage(
          `Comparison complete! Analyzed ${changedFiles.length} changed file(s).`
        );
      }
    );
  } catch (error: any) {
    vscode.window.showErrorMessage(`Comparison failed: ${error.message}`);
  }
}

