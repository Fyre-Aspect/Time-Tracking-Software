/**
 * Type definitions for the Time Tracker extension
 */

/**
 * Represents a single tracking session (one VS Code window open/close cycle)
 */
export interface TrackingSession {
    sessionId: string;
    startTime: string; // ISO date string
    endTime?: string;  // ISO date string
    totalDuration: number;  // milliseconds
    activeTime: number;     // milliseconds of actual activity
    idleTime: number;       // milliseconds of idle time
    repositories: RepoActivity[];
}

/**
 * Activity data for a single repository
 */
export interface RepoActivity {
    repoPath: string;
    repoName: string;
    branchName: string;
    remoteUrl?: string;
    timeSpent: number; // milliseconds
    filesEdited: string[];
    languages: LanguageTime;
}

/**
 * Map of language ID to time spent in milliseconds
 */
export interface LanguageTime {
    [languageId: string]: number;
}

/**
 * Daily tracking data stored in JSON files
 */
export interface DailyData {
    date: string; // YYYY-MM-DD format
    totalTime: number; // milliseconds
    activeTime: number;
    idleTime: number;
    sessions: TrackingSession[];
    repositories: RepoSummary[];
    languages: LanguageTime;
    emailSent: boolean;
    emailSentAt?: string;
}

/**
 * Summary of repository activity for the day
 */
export interface RepoSummary {
    repoName: string;
    repoPath: string;
    branchesWorkedOn: string[];
    totalTime: number;
    filesEdited: string[];
    languages: LanguageTime;
}

/**
 * Current tracking state (in-memory)
 */
export interface TrackingState {
    isTracking: boolean;
    sessionStart: Date;
    lastActivityTime: Date;
    currentRepo?: CurrentRepoInfo;
    isWindowFocused: boolean;
    isIdle: boolean;
    
    // Accumulators for current session
    sessionActiveTime: number;
    sessionIdleTime: number;
    
    // Current idle period tracking
    idleStartTime?: Date;
}

/**
 * Information about the currently active repository
 */
export interface CurrentRepoInfo {
    path: string;
    name: string;
    branch: string;
    remoteUrl?: string;
    activeFile?: string;
    language?: string;
    startTime: Date;
}

/**
 * Email configuration
 */
export interface EmailConfig {
    enabled: boolean;
    recipient: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword?: string; // Stored in secrets
    sendTime: string; // HH:MM format
    sendOnClose: boolean;
}

/**
 * Tracking configuration
 */
export interface TrackingConfig {
    idleThresholdMinutes: number;
    heartbeatIntervalSeconds: number;
}

/**
 * Email report data
 */
export interface EmailReportData {
    date: string;
    totalHours: number;
    totalMinutes: number;
    activeHours: number;
    activeMinutes: number;
    repositories: RepoReportData[];
    languages: LanguageReportData[];
    sessionCount: number;
}

/**
 * Repository data for email report
 */
export interface RepoReportData {
    name: string;
    hours: number;
    minutes: number;
    branches: string[];
    filesCount: number;
}

/**
 * Language data for email report
 */
export interface LanguageReportData {
    name: string;
    hours: number;
    minutes: number;
    percentage: number;
}

/**
 * Helper to format milliseconds to hours and minutes
 */
export function formatDuration(ms: number): { hours: number; minutes: number; formatted: string } {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    if (hours > 0) {
        return { hours, minutes, formatted: `${hours}h ${minutes}m` };
    }
    return { hours, minutes, formatted: `${minutes}m` };
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
