/**
 * Phase 3: Git Service for Shadow Repositories
 *
 * Handles:
 * - Creating shadow copies of folders
 * - Initializing git repos
 * - Creating commits with session metadata
 */

import { Command } from '@tauri-apps/plugin-shell';

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export class GitService {
  private static instance: GitService;

  private constructor() {}

  public static getInstance(): GitService {
    if (!GitService.instance) {
      GitService.instance = new GitService();
    }
    return GitService.instance;
  }

  /**
   * Copy folder to shadow repository location
   */
  public async copyToShadowRepo(
    sourcePath: string,
    shadowRepoPath: string
  ): Promise<void> {
    console.log(`📁 Copying folder to shadow repo...`);
    console.log(`  Source: ${sourcePath}`);
    console.log(`  Destination: ${shadowRepoPath}`);

    try {
      // Use rsync for efficient copying (preserves permissions, timestamps)
      const result = await Command.create('rsync', [
        '-av',
        '--delete',
        `${sourcePath}/`,
        shadowRepoPath
      ]).execute();

      if (result.code !== 0) {
        throw new Error(`rsync failed: ${result.stderr}`);
      }

      console.log(`  ✓ Folder copied successfully`);
    } catch (error) {
      console.error('Failed to copy folder:', error);
      throw error;
    }
  }

  /**
   * Initialize git repository in shadow repo
   */
  public async initGitRepo(repoPath: string): Promise<void> {
    console.log(`🔧 Initializing git repository...`);

    try {
      const result = await Command.create('git', ['init'], {
        cwd: repoPath
      }).execute();

      if (result.code !== 0) {
        throw new Error(`git init failed: ${result.stderr}`);
      }

      console.log(`  ✓ Git repository initialized`);
    } catch (error) {
      console.error('Failed to initialize git repo:', error);
      throw error;
    }
  }

  /**
   * Check if directory is already a git repository
   */
  public async isGitRepo(repoPath: string): Promise<boolean> {
    try {
      const result = await Command.create('git', ['rev-parse', '--git-dir'], {
        cwd: repoPath
      }).execute();

      return result.code === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create git commit with session metadata
   */
  public async createCommit(
    repoPath: string,
    sessionTitle: string,
    sessionId: string,
    sessionDate: string
  ): Promise<string> {
    console.log(`💾 Creating git commit...`);

    try {
      // Stage all files
      const addResult = await Command.create('git', ['add', '.'], {
        cwd: repoPath
      }).execute();

      if (addResult.code !== 0) {
        throw new Error(`git add failed: ${addResult.stderr}`);
      }

      // Create commit with session metadata
      const commitMessage = `Session: ${sessionTitle}

Session ID: ${sessionId}
Date: ${sessionDate}

📸 Snapshot created by Day Tracker
`;

      const commitResult = await Command.create('git', [
        'commit',
        '-m',
        commitMessage,
        '--allow-empty'
      ], {
        cwd: repoPath
      }).execute();

      if (commitResult.code !== 0) {
        throw new Error(`git commit failed: ${commitResult.stderr}`);
      }

      // Get commit hash
      const hashResult = await Command.create('git', [
        'rev-parse',
        'HEAD'
      ], {
        cwd: repoPath
      }).execute();

      if (hashResult.code !== 0) {
        throw new Error(`git rev-parse failed: ${hashResult.stderr}`);
      }

      const commitHash = hashResult.stdout.trim();
      console.log(`  ✓ Commit created: ${commitHash.substring(0, 7)}`);

      return commitHash;
    } catch (error) {
      console.error('Failed to create commit:', error);
      throw error;
    }
  }

  /**
   * Get commit information
   */
  public async getCommitInfo(
    repoPath: string,
    commitHash: string
  ): Promise<GitCommitInfo> {
    try {
      const result = await Command.create('git', [
        'show',
        '-s',
        '--format=%H%n%s%n%an%n%ai',
        commitHash
      ], {
        cwd: repoPath
      }).execute();

      if (result.code !== 0) {
        throw new Error(`git show failed: ${result.stderr}`);
      }

      const lines = result.stdout.trim().split('\n');
      return {
        hash: lines[0],
        message: lines[1],
        author: lines[2],
        date: lines[3]
      };
    } catch (error) {
      console.error('Failed to get commit info:', error);
      throw error;
    }
  }

  /**
   * List all commits in repository
   */
  public async listCommits(repoPath: string, limit: number = 10): Promise<GitCommitInfo[]> {
    try {
      const result = await Command.create('git', [
        'log',
        `-${limit}`,
        '--format=%H|||%s|||%an|||%ai'
      ], {
        cwd: repoPath
      }).execute();

      if (result.code !== 0) {
        throw new Error(`git log failed: ${result.stderr}`);
      }

      const commits = result.stdout
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const [hash, message, author, date] = line.split('|||');
          return { hash, message, author, date };
        });

      return commits;
    } catch (error) {
      console.error('Failed to list commits:', error);
      return [];
    }
  }
}

export const gitService = GitService.getInstance();
