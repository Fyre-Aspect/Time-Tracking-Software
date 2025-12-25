import * as vscode from 'vscode';
import { StorageService } from './storage';
import { GitService } from './gitService';
import { TrackerService } from './tracker';
import { EmailService } from './emailService';
import { StatusBarService, StatsPanel } from './statusBar';

let storageService: StorageService;
let gitService: GitService;
let trackerService: TrackerService;
let emailService: EmailService;
let statusBarService: StatusBarService;

/**
 * Extension activation - called when VS Code starts
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Time Tracker: Extension activating...');

    // Initialize services
    storageService = new StorageService(context);
    gitService = new GitService();
    statusBarService = new StatusBarService();

    // Create tracker with callback to update status bar
    trackerService = new TrackerService(
        storageService,
        gitService,
        (totalTime) => statusBarService.updateTime(totalTime)
    );

    // Create email service
    emailService = new EmailService(context, storageService);

    // Start tracking
    await trackerService.start();

    // Initialize status bar with today's data
    const todayData = storageService.getTodayData();
    statusBarService.updateTime(todayData.totalTime);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('timeTracker.showStats', () => {
            showStatistics(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timeTracker.sendReport', async () => {
            await emailService.sendDailyReport();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timeTracker.configureEmail', async () => {
            await emailService.configureEmail();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timeTracker.resetToday', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to reset today\'s tracking data?',
                { modal: true },
                'Reset'
            );
            if (confirm === 'Reset') {
                resetTodayData();
            }
        })
    );

    // Add services to disposables
    context.subscriptions.push({
        dispose: () => {
            trackerService.dispose();
            storageService.dispose();
            emailService.dispose();
            statusBarService.dispose();
        }
    });

    // Clean up old data files
    storageService.cleanupOldData();

    console.log('Time Tracker: Extension activated successfully');
}

/**
 * Show statistics panel
 */
function showStatistics(context: vscode.ExtensionContext): void {
    const todayData = storageService.getTodayData();
    const weekData = storageService.getHistoricalData(7);
    
    StatsPanel.createOrShow(
        context.extensionUri,
        todayData,
        weekData
    );
}

/**
 * Reset today's tracking data
 */
function resetTodayData(): void {
    // Stop current tracking
    trackerService.stop();
    
    // Clear today's data
    const emptyData = {
        date: new Date().toISOString().split('T')[0],
        totalTime: 0,
        activeTime: 0,
        idleTime: 0,
        sessions: [],
        repositories: [],
        languages: {},
        emailSent: false
    };
    storageService.saveDailyData(emptyData);
    
    // Restart tracking
    trackerService.start();
    statusBarService.updateTime(0);
    
    vscode.window.showInformationMessage('Time Tracker: Today\'s data has been reset');
}

/**
 * Extension deactivation - called when VS Code closes
 */
export async function deactivate(): Promise<void> {
    console.log('Time Tracker: Extension deactivating...');

    // Stop tracking and save data
    if (trackerService) {
        trackerService.stop();
    }

    // Send email report on close if configured
    if (emailService) {
        await emailService.sendOnClose();
        emailService.dispose();
    }

    // Final save
    if (storageService) {
        storageService.forceSave();
        storageService.dispose();
    }

    if (statusBarService) {
        statusBarService.dispose();
    }

    console.log('Time Tracker: Extension deactivated');
}
