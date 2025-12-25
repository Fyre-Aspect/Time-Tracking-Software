import * as vscode from 'vscode';
import { formatDuration } from './types';

/**
 * Status bar service for displaying current tracking time
 */
export class StatusBarService {
    private statusBarItem: vscode.StatusBarItem;
    private updateInterval: NodeJS.Timeout | null = null;
    private currentTime: number = 0;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'timeTracker.showStats';
        this.statusBarItem.tooltip = 'Click to view detailed statistics';
        this.updateDisplay();
        this.statusBarItem.show();

        // Update display every minute
        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 60000);
    }

    /**
     * Update the displayed time
     */
    public updateTime(totalTimeMs: number): void {
        this.currentTime = totalTimeMs;
        this.updateDisplay();
    }

    /**
     * Update the status bar display
     */
    private updateDisplay(): void {
        const { formatted } = formatDuration(this.currentTime);
        this.statusBarItem.text = `$(clock) ${formatted}`;
    }

    /**
     * Show that tracking is paused (idle)
     */
    public showIdle(): void {
        const { formatted } = formatDuration(this.currentTime);
        this.statusBarItem.text = `$(clock) ${formatted} (idle)`;
    }

    /**
     * Show active tracking
     */
    public showActive(): void {
        this.updateDisplay();
    }

    /**
     * Dispose the status bar item
     */
    public dispose(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.statusBarItem.dispose();
    }
}

/**
 * Creates a webview panel showing detailed statistics
 */
export class StatsPanel {
    public static currentPanel: StatsPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    /**
     * Create or show the stats panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        todayData: any,
        weekData: any[]
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (StatsPanel.currentPanel) {
            StatsPanel.currentPanel.panel.reveal(column);
            StatsPanel.currentPanel.update(todayData, weekData);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'timeTrackerStats',
            'Time Tracker Statistics',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        StatsPanel.currentPanel = new StatsPanel(panel);
        StatsPanel.currentPanel.update(todayData, weekData);
    }

    /**
     * Update the panel content
     */
    public update(todayData: any, weekData: any[]): void {
        this.panel.webview.html = this.getHtmlContent(todayData, weekData);
    }

    /**
     * Generate HTML content for the webview
     */
    private getHtmlContent(todayData: any, weekData: any[]): string {
        const formatTime = (ms: number) => {
            const { formatted } = formatDuration(ms);
            return formatted;
        };

        const todayTotal = formatTime(todayData.totalTime);
        const todayActive = formatTime(todayData.activeTime);

        // Generate repo table rows
        const repoRows = todayData.repositories.map((repo: any) => `
            <tr>
                <td>${repo.repoName}</td>
                <td>${formatTime(repo.totalTime)}</td>
                <td>${repo.branchesWorkedOn.join(', ')}</td>
                <td>${repo.filesEdited.length}</td>
            </tr>
        `).join('');

        // Generate language stats
        const langItems = Object.entries(todayData.languages || {})
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 10)
            .map(([lang, time]) => `
                <div class="lang-item">
                    <span class="lang-name">${lang}</span>
                    <span class="lang-time">${formatTime(time as number)}</span>
                </div>
            `).join('');

        // Generate week chart data
        const weekChartData = weekData.map(d => ({
            date: d.date.split('-').slice(1).join('/'),
            hours: d.totalTime / 3600000
        })).reverse();

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Time Tracker Statistics</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        h1 {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        h2 {
            margin-top: 30px;
            color: var(--vscode-textLink-foreground);
        }
        .summary-cards {
            display: flex;
            gap: 20px;
            margin: 20px 0;
        }
        .card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 20px;
            border-radius: 8px;
            flex: 1;
            text-align: center;
        }
        .card-value {
            font-size: 32px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .card-label {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .lang-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .chart-container {
            height: 200px;
            display: flex;
            align-items: flex-end;
            gap: 10px;
            padding: 20px 0;
        }
        .chart-bar {
            flex: 1;
            background: var(--vscode-textLink-foreground);
            border-radius: 4px 4px 0 0;
            position: relative;
            min-height: 5px;
        }
        .chart-label {
            position: absolute;
            bottom: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .chart-value {
            position: absolute;
            top: -20px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 11px;
        }
    </style>
</head>
<body>
    <h1>📊 Time Tracker Statistics</h1>
    
    <h2>Today - ${todayData.date}</h2>
    <div class="summary-cards">
        <div class="card">
            <div class="card-value">${todayTotal}</div>
            <div class="card-label">Total Time</div>
        </div>
        <div class="card">
            <div class="card-value">${todayActive}</div>
            <div class="card-label">Active Coding</div>
        </div>
        <div class="card">
            <div class="card-value">${todayData.sessions.length}</div>
            <div class="card-label">Sessions</div>
        </div>
        <div class="card">
            <div class="card-value">${todayData.repositories.length}</div>
            <div class="card-label">Repositories</div>
        </div>
    </div>

    ${todayData.repositories.length > 0 ? `
    <h2>📁 Repositories</h2>
    <table>
        <tr>
            <th>Repository</th>
            <th>Time</th>
            <th>Branches</th>
            <th>Files Edited</th>
        </tr>
        ${repoRows}
    </table>
    ` : ''}

    ${Object.keys(todayData.languages || {}).length > 0 ? `
    <h2>💻 Languages</h2>
    <div class="languages-list">
        ${langItems}
    </div>
    ` : ''}

    <h2>📈 Last 7 Days</h2>
    <div class="chart-container">
        ${weekChartData.map(d => {
            const height = Math.max(5, (d.hours / 10) * 150);
            return `
                <div class="chart-bar" style="height: ${height}px">
                    <span class="chart-value">${d.hours.toFixed(1)}h</span>
                    <span class="chart-label">${d.date}</span>
                </div>
            `;
        }).join('')}
    </div>
</body>
</html>
        `;
    }

    /**
     * Dispose the panel
     */
    public dispose(): void {
        StatsPanel.currentPanel = undefined;
        this.panel.dispose();
        
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
