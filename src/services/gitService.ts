import * as vscode from 'vscode';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { CommitInfo } from '../types';

export class GitService {
  private git: SimpleGit;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.git = simpleGit(workspaceRoot);
  }

  async isRepository(): Promise<boolean> {
    try {
      const isRepo = await this.git.checkIsRepo();
      return isRepo;
    } catch {
      return false;
    }
  }

  async getPreviousCommitHash(): Promise<string | null> {
    try {
      const log = await this.git.log({ maxCount: 2 });
      if (log.total < 2) {
        return null; // No previous commit
      }
      return log.all[1].hash;
    } catch (error: any) {
      throw new Error(`Failed to get previous commit: ${error.message}`);
    }
  }

  async getCurrentCommitHash(): Promise<string | null> {
    try {
      const log = await this.git.log({ maxCount: 1 });
      if (log.total === 0) {
        return null;
      }
      return log.all[0].hash;
    } catch (error: any) {
      throw new Error(`Failed to get current commit: ${error.message}`);
    }
  }

  async validateCommitHash(hash: string): Promise<boolean> {
    try {
      await this.git.show([hash, '--format=%H', '-s']);
      return true;
    } catch {
      return false;
    }
  }

  async getCommitInfo(commitHash: string): Promise<CommitInfo> {
    try {
      // First, try to get all recent commits and find the matching one
      // This is more reliable than using range syntax which can fail for root commits
      const allLog = await this.git.log({ maxCount: 100 });
      const matchingCommit = allLog.all.find(commit => 
        commit.hash === commitHash || commit.hash.startsWith(commitHash)
      );
      
      if (matchingCommit) {
        return {
          hash: matchingCommit.hash,
          message: matchingCommit.message,
          author: matchingCommit.author_name,
          date: matchingCommit.date
        };
      }

      // If not found in recent commits, try using show command to verify commit exists
      try {
        await this.git.show([commitHash, '--format=%H', '-s']);
        // If show succeeds, the commit exists but wasn't in recent 100 commits
        // Try to get it with a larger log or use show to extract info
        const showOutput = await this.git.show([commitHash, '--format=%H|%s|%an|%ai', '-s', '--no-patch']);
        const parts = showOutput.trim().split('|');
        
        if (parts.length >= 4) {
          return {
            hash: parts[0] || commitHash,
            message: parts[1] || 'No message',
            author: parts[2] || 'Unknown',
            date: parts[3] || new Date().toISOString()
          };
        }
      } catch (showError) {
        // Show failed, commit doesn't exist
      }
      
      throw new Error(`Commit ${commitHash} not found`);
    } catch (error: any) {
      throw new Error(`Failed to get commit info: ${error.message}`);
    }
  }

  async getDiffWorkingDir(commitHash: string): Promise<string> {
    try {
      const diff = await this.git.diff([commitHash, '--']);
      return diff;
    } catch (error: any) {
      throw new Error(`Failed to get working directory diff: ${error.message}`);
    }
  }

  async getDiffHead(commitHash: string): Promise<string> {
    try {
      const currentHash = await this.getCurrentCommitHash();
      if (!currentHash) {
        throw new Error('No commits found in repository');
      }
      const diff = await this.git.diff([commitHash, currentHash]);
      return diff;
    } catch (error: any) {
      throw new Error(`Failed to get HEAD diff: ${error.message}`);
    }
  }

  async getDiff(commitHash: string, comparisonType: 'working-dir' | 'head'): Promise<string> {
    if (comparisonType === 'working-dir') {
      return this.getDiffWorkingDir(commitHash);
    } else {
      return this.getDiffHead(commitHash);
    }
  }

  getChangedFiles(diff: string): string[] {
    const changedFiles = new Set<string>();
    const lines = diff.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match diff header lines: diff --git a/path b/path or --- a/path or +++ b/path
      if (line.startsWith('diff --git')) {
        // Extract file path from "diff --git a/path b/path"
        const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
        if (match) {
          const filePath = match[2]; // Use the 'b' path (new file)
          changedFiles.add(filePath);
        }
      } else if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
        // Extract file path from --- a/path or +++ b/path
        const match = line.match(/^(?:---|\+\+\+) [ab]\/(.+?)$/);
        if (match) {
          const filePath = match[1];
          // Skip /dev/null which indicates file was added or deleted
          if (filePath !== '/dev/null') {
            changedFiles.add(filePath);
          }
        }
      }
    }

    // Convert to absolute paths
    return Array.from(changedFiles)
      .map(file => path.isAbsolute(file) ? file : path.join(this.workspaceRoot, file))
      .filter(file => {
        // Filter out binary files and non-code files if needed
        return true;
      });
  }

  async getRecentCommits(count: number = 10): Promise<CommitInfo[]> {
    try {
      const log = await this.git.log({ maxCount: count });
      return log.all.map(commit => ({
        hash: commit.hash, // Full hash
        message: commit.message,
        author: commit.author_name,
        date: commit.date
      }));
    } catch (error: any) {
      throw new Error(`Failed to get recent commits: ${error.message}`);
    }
  }
}

