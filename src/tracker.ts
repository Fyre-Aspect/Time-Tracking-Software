import * as vscode from 'vscode';
import { 
    TrackingState, 
    TrackingSession, 
    RepoActivity, 
    CurrentRepoInfo,
    TrackingConfig,
    generateSessionId,
    getTodayDateString
} from './types';
import { StorageService } from './storage';
import { GitService, GitRepoInfo } from './gitService';

/**
 * Main tracking service that monitors VS Code usage
 */
export class TrackerService {
    private state: TrackingState;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private disposables: vscode.Disposable[] = [];
    private repoActivityMap: Map<string, RepoActivity> = new Map();
    private currentSession: TrackingSession;
    private config: TrackingConfig;

    constructor(
        private storage: StorageService,
        private gitService: GitService,
        private onTimeUpdate: (totalTime: number) => void
    ) {
        this.config = this.loadConfig();
        this.state = this.initializeState();
        this.currentSession = this.createNewSession();
    }

    /**
     * Load tracking configuration from VS Code settings
     */
    private loadConfig(): TrackingConfig {
        const config = vscode.workspace.getConfiguration('timeTracker.tracking');
        return {
            idleThresholdMinutes: config.get('idleThresholdMinutes', 3),
            heartbeatIntervalSeconds: config.get('heartbeatIntervalSeconds', 30)
        };
    }

    /**
     * Initialize tracking state
     */
    private initializeState(): TrackingState {
        return {
            isTracking: false,
            sessionStart: new Date(),
            lastActivityTime: new Date(),
            isWindowFocused: vscode.window.state.focused,
            isIdle: false,
            sessionActiveTime: 0,
            sessionIdleTime: 0
        };
    }

    /**
     * Create a new tracking session
     */
    private createNewSession(): TrackingSession {
        return {
            sessionId: generateSessionId(),
            startTime: new Date().toISOString(),
            totalDuration: 0,
            activeTime: 0,
            idleTime: 0,
            repositories: []
        };
    }

    /**
     * Start tracking
     */
    public async start(): Promise<void> {
        if (this.state.isTracking) {
            return;
        }

        this.state.isTracking = true;
        this.state.sessionStart = new Date();
        this.state.lastActivityTime = new Date();
        this.currentSession = this.createNewSession();

        // Set up event listeners
        this.setupEventListeners();

        // Start heartbeat
        this.startHeartbeat();

        // Initialize with current workspace
        await this.updateCurrentRepo();

        console.log('Time Tracker: Tracking started');
    }

    /**
     * Set up VS Code event listeners
     */
    private setupEventListeners(): void {
        // Window focus changes
        this.disposables.push(
            vscode.window.onDidChangeWindowState(state => {
                this.handleWindowStateChange(state.focused);
            })
        );

        // Text document changes (typing activity)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.contentChanges.length > 0) {
                    this.recordActivity();
                }
            })
        );

        // Active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.handleEditorChange(editor);
            })
        );

        // Document saves
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(document => {
                this.recordActivity();
                this.recordFileEdit(document.uri.fsPath);
            })
        );

        // Workspace folder changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.updateCurrentRepo();
            })
        );

        // Configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('timeTracker.tracking')) {
                    this.config = this.loadConfig();
                }
            })
        );
    }

    /**
     * Start the heartbeat interval
     */
    private startHeartbeat(): void {
        const intervalMs = this.config.heartbeatIntervalSeconds * 1000;
        
        this.heartbeatInterval = setInterval(() => {
            this.heartbeat();
        }, intervalMs);
    }

    /**
     * Heartbeat - called periodically to update tracking
     */
    private heartbeat(): void {
        if (!this.state.isTracking) {
            return;
        }

        const now = new Date();
        const timeSinceLastActivity = now.getTime() - this.state.lastActivityTime.getTime();
        const idleThresholdMs = this.config.idleThresholdMinutes * 60 * 1000;

        // Check for day change
        if (getTodayDateString() !== this.currentSession.startTime.split('T')[0]) {
            this.handleDayChange();
            return;
        }

        // Check if we've become idle
        if (!this.state.isIdle && timeSinceLastActivity > idleThresholdMs) {
            this.enterIdleState();
        }

        // Update time counters
        this.updateTimeCounters();

        // Update storage
        this.saveCurrentSession();

        // Notify UI
        const todayData = this.storage.getTodayData();
        this.onTimeUpdate(todayData.totalTime);
    }

    /**
     * Handle window focus state changes
     */
    private handleWindowStateChange(focused: boolean): void {
        this.state.isWindowFocused = focused;

        if (focused) {
            // Window regained focus
            this.recordActivity();
            if (this.state.isIdle) {
                this.exitIdleState();
            }
        } else {
            // Window lost focus - start considering idle time
            this.state.idleStartTime = new Date();
        }
    }

    /**
     * Handle active editor changes
     */
    private async handleEditorChange(editor: vscode.TextEditor | undefined): Promise<void> {
        this.recordActivity();

        if (editor) {
            // Update current repo based on the file
            await this.updateCurrentRepo(editor.document.uri.fsPath);
            
            // Track language
            if (this.state.currentRepo) {
                this.state.currentRepo.language = editor.document.languageId;
                this.state.currentRepo.activeFile = editor.document.uri.fsPath;
            }
        }
    }

    /**
     * Record user activity
     */
    private recordActivity(): void {
        const now = new Date();
        
        // If we were idle, exit idle state
        if (this.state.isIdle) {
            this.exitIdleState();
        }

        // Update activity tracking for current repo
        if (this.state.currentRepo) {
            const elapsed = now.getTime() - this.state.lastActivityTime.getTime();
            this.addTimeToRepo(this.state.currentRepo, elapsed);
        }

        this.state.lastActivityTime = now;
    }

    /**
     * Enter idle state
     */
    private enterIdleState(): void {
        if (this.state.isIdle) {
            return;
        }

        this.state.isIdle = true;
        this.state.idleStartTime = this.state.lastActivityTime;
        console.log('Time Tracker: Entered idle state');
    }

    /**
     * Exit idle state
     */
    private exitIdleState(): void {
        if (!this.state.isIdle) {
            return;
        }

        // Calculate idle duration
        if (this.state.idleStartTime) {
            const idleDuration = new Date().getTime() - this.state.idleStartTime.getTime();
            this.state.sessionIdleTime += idleDuration;
        }

        this.state.isIdle = false;
        this.state.idleStartTime = undefined;
        console.log('Time Tracker: Exited idle state');
    }

    /**
     * Update current repository based on active file or workspace
     */
    private async updateCurrentRepo(filePath?: string): Promise<void> {
        let repoInfo: GitRepoInfo | null = null;

        if (filePath) {
            repoInfo = await this.gitService.getRepoForFile(filePath);
        } else {
            // Use active editor or first workspace folder
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                repoInfo = await this.gitService.getRepoForFile(editor.document.uri.fsPath);
            } else if (vscode.workspace.workspaceFolders?.[0]) {
                repoInfo = await this.gitService.getRepoFromVSCodeGit(
                    vscode.workspace.workspaceFolders[0].uri.fsPath
                );
            }
        }

        // Finalize time for previous repo if changing
        if (this.state.currentRepo && repoInfo && 
            this.state.currentRepo.path !== repoInfo.path) {
            this.finalizeRepoTime(this.state.currentRepo);
        }

        if (repoInfo) {
            this.state.currentRepo = {
                path: repoInfo.path,
                name: repoInfo.name,
                branch: repoInfo.branch,
                remoteUrl: repoInfo.remoteUrl,
                startTime: new Date(),
                language: vscode.window.activeTextEditor?.document.languageId,
                activeFile: vscode.window.activeTextEditor?.document.uri.fsPath
            };
        } else {
            // Working on a non-git folder
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                this.state.currentRepo = {
                    path: workspaceFolder.uri.fsPath,
                    name: workspaceFolder.name,
                    branch: 'N/A',
                    startTime: new Date(),
                    language: vscode.window.activeTextEditor?.document.languageId,
                    activeFile: vscode.window.activeTextEditor?.document.uri.fsPath
                };
            }
        }
    }

    /**
     * Add time to a repository's tracking
     */
    private addTimeToRepo(repo: CurrentRepoInfo, timeMs: number): void {
        const key = `${repo.path}:${repo.branch}`;
        let activity = this.repoActivityMap.get(key);

        if (!activity) {
            activity = {
                repoPath: repo.path,
                repoName: repo.name,
                branchName: repo.branch,
                remoteUrl: repo.remoteUrl,
                timeSpent: 0,
                filesEdited: [],
                languages: {}
            };
            this.repoActivityMap.set(key, activity);
        }

        activity.timeSpent += timeMs;

        // Track language time
        if (repo.language) {
            activity.languages[repo.language] = (activity.languages[repo.language] || 0) + timeMs;
        }
    }

    /**
     * Finalize time tracking for a repo (when switching away)
     */
    private finalizeRepoTime(repo: CurrentRepoInfo): void {
        const elapsed = new Date().getTime() - repo.startTime.getTime();
        this.addTimeToRepo(repo, elapsed);
    }

    /**
     * Record a file edit
     */
    private recordFileEdit(filePath: string): void {
        if (!this.state.currentRepo) {
            return;
        }

        const key = `${this.state.currentRepo.path}:${this.state.currentRepo.branch}`;
        const activity = this.repoActivityMap.get(key);

        if (activity && !activity.filesEdited.includes(filePath)) {
            activity.filesEdited.push(filePath);
        }
    }

    /**
     * Update time counters
     */
    private updateTimeCounters(): void {
        const now = new Date();
        const sessionDuration = now.getTime() - new Date(this.currentSession.startTime).getTime();
        
        this.currentSession.totalDuration = sessionDuration;
        this.currentSession.idleTime = this.state.sessionIdleTime;
        this.currentSession.activeTime = sessionDuration - this.state.sessionIdleTime;

        // If currently idle, add ongoing idle time
        if (this.state.isIdle && this.state.idleStartTime) {
            const currentIdleTime = now.getTime() - this.state.idleStartTime.getTime();
            this.currentSession.idleTime += currentIdleTime;
            this.currentSession.activeTime = this.currentSession.totalDuration - this.currentSession.idleTime;
        }
    }

    /**
     * Save current session to storage
     */
    private saveCurrentSession(): void {
        // Update repositories array from map
        this.currentSession.repositories = Array.from(this.repoActivityMap.values());
        this.currentSession.endTime = new Date().toISOString();

        this.storage.updateSession(this.currentSession);
    }

    /**
     * Handle day change (midnight rollover)
     */
    private handleDayChange(): void {
        // Save final data for previous day
        this.saveCurrentSession();
        this.storage.forceSave();

        // Start fresh for new day
        this.state = this.initializeState();
        this.state.isTracking = true;
        this.currentSession = this.createNewSession();
        this.repoActivityMap.clear();

        console.log('Time Tracker: Day changed, started new tracking day');
    }

    /**
     * Get current session data
     */
    public getCurrentSession(): TrackingSession {
        this.updateTimeCounters();
        this.currentSession.repositories = Array.from(this.repoActivityMap.values());
        return this.currentSession;
    }

    /**
     * Stop tracking
     */
    public stop(): void {
        if (!this.state.isTracking) {
            return;
        }

        // Finalize current repo
        if (this.state.currentRepo) {
            this.finalizeRepoTime(this.state.currentRepo);
        }

        // Final save
        this.updateTimeCounters();
        this.saveCurrentSession();
        this.storage.forceSave();

        // Clean up
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];

        this.state.isTracking = false;
        console.log('Time Tracker: Tracking stopped');
    }

    /**
     * Dispose the tracker
     */
    public dispose(): void {
        this.stop();
    }
}
