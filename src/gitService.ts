import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

/**
 * Information about a Git repository
 */
export interface GitRepoInfo {
    path: string;
    name: string;
    branch: string;
    remoteUrl?: string;
}

/**
 * Service for interacting with Git to get repository information
 */
export class GitService {
    /**
     * Get Git repository info for a workspace folder
     */
    public async getRepoInfo(workspacePath: string): Promise<GitRepoInfo | null> {
        try {
            // Check if this is a git repository
            const isGitRepo = await this.execGit(workspacePath, 'rev-parse', '--is-inside-work-tree');
            if (isGitRepo.trim() !== 'true') {
                return null;
            }

            // Get repo root path
            const repoRoot = await this.execGit(workspacePath, 'rev-parse', '--show-toplevel');
            const repoPath = repoRoot.trim();
            
            // Get repo name from path
            const repoName = path.basename(repoPath);

            // Get current branch
            let branch = 'unknown';
            try {
                branch = (await this.execGit(workspacePath, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
            } catch {
                // Fallback for detached HEAD
                try {
                    branch = (await this.execGit(workspacePath, 'describe', '--tags', '--always')).trim();
                } catch {
                    branch = 'detached';
                }
            }

            // Get remote URL (optional)
            let remoteUrl: string | undefined;
            try {
                remoteUrl = (await this.execGit(workspacePath, 'config', '--get', 'remote.origin.url')).trim();
                if (remoteUrl) {
                    // Clean up the URL for display
                    remoteUrl = this.cleanRemoteUrl(remoteUrl);
                }
            } catch {
                // No remote configured
            }

            return {
                path: repoPath,
                name: repoName,
                branch,
                remoteUrl
            };
        } catch (error) {
            // Not a git repository or git not installed
            return null;
        }
    }

    /**
     * Clean up Git remote URL for display (remove credentials, .git suffix)
     */
    private cleanRemoteUrl(url: string): string {
        // Remove .git suffix
        if (url.endsWith('.git')) {
            url = url.slice(0, -4);
        }

        // Remove credentials from URL
        url = url.replace(/\/\/[^@]+@/, '//');

        // Convert SSH URL to HTTPS format for display
        if (url.startsWith('git@')) {
            url = url.replace('git@', 'https://').replace(':', '/');
        }

        return url;
    }

    /**
     * Execute a git command
     */
    private execGit(cwd: string, ...args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.execFile('git', args, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * Get repo info for all workspace folders
     */
    public async getAllWorkspaceRepos(): Promise<Map<string, GitRepoInfo>> {
        const repos = new Map<string, GitRepoInfo>();
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            return repos;
        }

        for (const folder of workspaceFolders) {
            const repoInfo = await this.getRepoInfo(folder.uri.fsPath);
            if (repoInfo) {
                repos.set(folder.uri.fsPath, repoInfo);
            }
        }

        return repos;
    }

    /**
     * Get repo info for a specific file
     */
    public async getRepoForFile(filePath: string): Promise<GitRepoInfo | null> {
        const dirPath = path.dirname(filePath);
        return this.getRepoInfo(dirPath);
    }

    /**
     * Try to use VS Code's built-in Git extension for better integration
     */
    public async getRepoFromVSCodeGit(folderPath: string): Promise<GitRepoInfo | null> {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                return this.getRepoInfo(folderPath);
            }

            const git = gitExtension.isActive 
                ? gitExtension.exports 
                : await gitExtension.activate();

            const api = git.getAPI(1);
            if (!api) {
                return this.getRepoInfo(folderPath);
            }

            const repository = api.repositories.find((repo: any) => 
                folderPath.startsWith(repo.rootUri.fsPath)
            );

            if (!repository) {
                return this.getRepoInfo(folderPath);
            }

            const head = repository.state.HEAD;
            return {
                path: repository.rootUri.fsPath,
                name: path.basename(repository.rootUri.fsPath),
                branch: head?.name || head?.commit?.substring(0, 7) || 'unknown',
                remoteUrl: repository.state.remotes[0]?.fetchUrl 
                    ? this.cleanRemoteUrl(repository.state.remotes[0].fetchUrl)
                    : undefined
            };
        } catch (error) {
            // Fallback to command line git
            return this.getRepoInfo(folderPath);
        }
    }
}
