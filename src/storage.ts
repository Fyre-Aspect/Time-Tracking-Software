import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AggregateTotals, DailyData, TrackingSession, RepoSummary, getTodayDateString, LanguageTime } from './types';

/**
 * Service for persisting tracking data to JSON files
 */
export class StorageService {
    private storagePath: string;
    private currentDayData: DailyData | null = null;
    private saveDebounceTimer: NodeJS.Timeout | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.storagePath = context.globalStorageUri.fsPath;
        this.ensureStorageDirectory();
    }

    /**
     * Ensure the storage directory exists
     */
    private ensureStorageDirectory(): void {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    /**
     * Get the file path for a specific date's data
     */
    private getDataFilePath(date: string): string {
        return path.join(this.storagePath, `${date}.json`);
    }

    /**
     * Load data for a specific date
     */
    public loadDailyData(date: string): DailyData {
        const filePath = this.getDataFilePath(date);
        
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(content) as DailyData;
            } catch (error) {
                console.error(`Error loading data for ${date}:`, error);
            }
        }

        // Return empty daily data
        return this.createEmptyDailyData(date);
    }

    /**
     * Create empty daily data structure
     */
    private createEmptyDailyData(date: string): DailyData {
        return {
            date,
            totalTime: 0,
            activeTime: 0,
            idleTime: 0,
            sessions: [],
            repositories: [],
            languages: {},
            emailSent: false
        };
    }

    /**
     * Get today's data, loading from file or creating new
     */
    public getTodayData(): DailyData {
        const today = getTodayDateString();
        
        if (this.currentDayData && this.currentDayData.date === today) {
            return this.currentDayData;
        }

        this.currentDayData = this.loadDailyData(today);
        return this.currentDayData;
    }

    /**
     * Save data for a specific date
     */
    public saveDailyData(data: DailyData): void {
        const filePath = this.getDataFilePath(data.date);
        
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Error saving data for ${data.date}:`, error);
            vscode.window.showErrorMessage(`Time Tracker: Failed to save tracking data`);
        }
    }

    /**
     * Save today's data with debouncing to avoid excessive writes
     */
    public saveTodayData(data: DailyData): void {
        this.currentDayData = data;
        
        // Debounce saves to avoid too many file writes
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }

        this.saveDebounceTimer = setTimeout(() => {
            this.saveDailyData(data);
            this.saveDebounceTimer = null;
        }, 5000); // Save every 5 seconds at most
    }

    /**
     * Force immediate save of today's data
     */
    public forceSave(): void {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
        
        if (this.currentDayData) {
            this.saveDailyData(this.currentDayData);
        }
    }

    /**
     * Add or update a session in today's data
     */
    public updateSession(session: TrackingSession): void {
        const data = this.getTodayData();
        
        const existingIndex = data.sessions.findIndex(s => s.sessionId === session.sessionId);
        if (existingIndex >= 0) {
            data.sessions[existingIndex] = session;
        } else {
            data.sessions.push(session);
        }

        // Recalculate totals
        this.recalculateTotals(data);
        this.saveTodayData(data);
    }

    /**
     * Recalculate daily totals from sessions
     */
    private recalculateTotals(data: DailyData): void {
        data.totalTime = 0;
        data.activeTime = 0;
        data.idleTime = 0;
        data.languages = {};
        
        const repoMap = new Map<string, RepoSummary>();

        for (const session of data.sessions) {
            data.totalTime += session.totalDuration;
            data.activeTime += session.activeTime;
            data.idleTime += session.idleTime;

            // Aggregate languages
            for (const [lang, time] of Object.entries(session.repositories.reduce((acc, repo) => {
                for (const [l, t] of Object.entries(repo.languages)) {
                    acc[l] = (acc[l] || 0) + t;
                }
                return acc;
            }, {} as LanguageTime))) {
                data.languages[lang] = (data.languages[lang] || 0) + time;
            }

            // Aggregate repositories
            for (const repo of session.repositories) {
                const existing = repoMap.get(repo.repoPath);
                if (existing) {
                    existing.totalTime += repo.timeSpent;
                    if (!existing.branchesWorkedOn.includes(repo.branchName)) {
                        existing.branchesWorkedOn.push(repo.branchName);
                    }
                    for (const file of repo.filesEdited) {
                        if (!existing.filesEdited.includes(file)) {
                            existing.filesEdited.push(file);
                        }
                    }
                    for (const [lang, time] of Object.entries(repo.languages)) {
                        existing.languages[lang] = (existing.languages[lang] || 0) + time;
                    }
                } else {
                    repoMap.set(repo.repoPath, {
                        repoName: repo.repoName,
                        repoPath: repo.repoPath,
                        branchesWorkedOn: [repo.branchName],
                        totalTime: repo.timeSpent,
                        filesEdited: [...repo.filesEdited],
                        languages: { ...repo.languages }
                    });
                }
            }
        }

        data.repositories = Array.from(repoMap.values());
    }

    /**
     * Mark email as sent for today
     */
    public markEmailSent(): void {
        const data = this.getTodayData();
        data.emailSent = true;
        data.emailSentAt = new Date().toISOString();
        this.saveTodayData(data);
        this.forceSave();
    }

    /**
     * Check if email was already sent today
     */
    public wasEmailSentToday(): boolean {
        const data = this.getTodayData();
        return data.emailSent;
    }

    /**
     * Get data for the last N days
     */
    public getHistoricalData(days: number): DailyData[] {
        const result: DailyData[] = [];
        const today = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const data = this.loadDailyData(dateStr);
            if (data.totalTime > 0) {
                result.push(data);
            }
        }

        return result;
    }

    /**
     * Get aggregated totals for overall, week, month, and year-to-date
     */
    public getAggregateTotals(): AggregateTotals {
        const totals: AggregateTotals = {
            last7Days: 0,
            overall: 0,
            weekToDate: 0,
            monthToDate: 0,
            yearToDate: 0
        };

        const now = new Date();
        const startOfWeek = this.getStartOfWeek(now);
        const startOfLast7 = new Date(now);
        startOfLast7.setDate(now.getDate() - 6);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        startOfWeek.setHours(0, 0, 0, 0);
        startOfLast7.setHours(0, 0, 0, 0);
        startOfMonth.setHours(0, 0, 0, 0);
        startOfYear.setHours(0, 0, 0, 0);

        const processedDates = new Set<string>();

        const addData = (data: DailyData): void => {
            if (!data?.date || processedDates.has(data.date)) {
                return;
            }

            const dateObj = new Date(data.date);
            if (Number.isNaN(dateObj.getTime())) {
                return;
            }

            processedDates.add(data.date);
            totals.overall += data.totalTime;

            if (dateObj >= startOfLast7) {
                totals.last7Days += data.totalTime;
            }
            if (dateObj >= startOfYear) {
                totals.yearToDate += data.totalTime;
            }
            if (dateObj >= startOfMonth) {
                totals.monthToDate += data.totalTime;
            }
            if (dateObj >= startOfWeek) {
                totals.weekToDate += data.totalTime;
            }
        };

        // Always include in-memory today data to reflect unsaved changes
        addData(this.getTodayData());

        try {
            const files = fs.readdirSync(this.storagePath);
            for (const file of files) {
                if (!file.endsWith('.json')) {
                    continue;
                }
                const dateStr = file.replace('.json', '');
                if (processedDates.has(dateStr)) {
                    continue;
                }

                const data = this.loadDailyData(dateStr);
                addData(data);
            }
        } catch (error) {
            console.error('Error reading aggregate totals:', error);
        }

        return totals;
    }

    /**
     * Calculate Monday as the start of the current week
     */
    private getStartOfWeek(date: Date): Date {
        const result = new Date(date);
        const day = result.getDay();
        const diff = (day + 6) % 7; // Convert Sunday(0) to 6, Monday(1) to 0
        result.setDate(result.getDate() - diff);
        result.setHours(0, 0, 0, 0);
        return result;
    }

    /**
     * Clean up old data files (older than 90 days)
     */
    public cleanupOldData(): void {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 90);

        try {
            const files = fs.readdirSync(this.storagePath);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const dateStr = file.replace('.json', '');
                    const fileDate = new Date(dateStr);
                    if (fileDate < cutoffDate) {
                        fs.unlinkSync(path.join(this.storagePath, file));
                    }
                }
            }
        } catch (error) {
            console.error('Error cleaning up old data:', error);
        }
    }

    /**
     * Dispose and save any pending data
     */
    public dispose(): void {
        this.forceSave();
    }
}
