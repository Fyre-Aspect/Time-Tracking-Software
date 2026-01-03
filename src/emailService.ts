import * as vscode from 'vscode';
import * as nodemailer from 'nodemailer';
import { 
    DailyData, 
    AggregateTotals,
    EmailConfig, 
    EmailReportData, 
    RepoReportData, 
    LanguageReportData,
    formatDuration 
} from './types';
import { StorageService } from './storage';

/**
 * Service for sending daily email reports
 */
export class EmailService {
    private scheduledTimeout: NodeJS.Timeout | null = null;
    private config: EmailConfig;

    constructor(
        private context: vscode.ExtensionContext,
        private storage: StorageService
    ) {
        this.config = this.loadConfig();
        this.scheduleNextEmail();

        // Listen for config changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('timeTracker.email')) {
                this.config = this.loadConfig();
                this.scheduleNextEmail();
            }
        });
    }

    /**
     * Load email configuration from VS Code settings
     */
    private loadConfig(): EmailConfig {
        const config = vscode.workspace.getConfiguration('timeTracker.email');
        return {
            enabled: config.get('enabled', true),
            recipient: config.get('recipient', ''),
            smtpHost: config.get('smtpHost', 'smtp.gmail.com'),
            smtpPort: config.get('smtpPort', 587),
            smtpUser: config.get('smtpUser', ''),
            sendTime: config.get('sendTime', '18:00'),
            sendOnClose: config.get('sendOnClose', true)
        };
    }

    /**
     * Check if email is properly configured
     */
    public isConfigured(): boolean {
        return !!(
            this.config.enabled &&
            this.config.recipient &&
            this.config.smtpHost &&
            this.config.smtpUser
        );
    }

    /**
     * Get SMTP password from secure storage
     */
    private async getPassword(): Promise<string | undefined> {
        return this.context.secrets.get('timeTracker.smtpPassword');
    }

    /**
     * Set SMTP password in secure storage
     */
    public async setPassword(password: string): Promise<void> {
        await this.context.secrets.store('timeTracker.smtpPassword', password);
    }

    /**
     * Schedule the next daily email
     */
    private scheduleNextEmail(): void {
        if (this.scheduledTimeout) {
            clearTimeout(this.scheduledTimeout);
            this.scheduledTimeout = null;
        }

        if (!this.config.enabled || !this.config.sendTime) {
            return;
        }

        const now = new Date();
        const [hours, minutes] = this.config.sendTime.split(':').map(Number);
        
        const nextSend = new Date(now);
        nextSend.setHours(hours, minutes, 0, 0);

        // If time has passed today, schedule for tomorrow
        if (nextSend <= now) {
            nextSend.setDate(nextSend.getDate() + 1);
        }

        const delay = nextSend.getTime() - now.getTime();
        
        this.scheduledTimeout = setTimeout(() => {
            this.sendDailyReport();
            // Schedule next day
            this.scheduleNextEmail();
        }, delay);

        console.log(`Time Tracker: Email scheduled for ${nextSend.toLocaleString()}`);
    }

    /**
     * Send daily report email
     */
    public async sendDailyReport(): Promise<boolean> {
        if (!this.isConfigured()) {
            console.log('Time Tracker: Email not configured, skipping report');
            return false;
        }

        // Check if already sent today
        if (this.storage.wasEmailSentToday()) {
            console.log('Time Tracker: Email already sent today');
            return false;
        }

        const password = await this.getPassword();
        if (!password) {
            vscode.window.showWarningMessage(
                'Time Tracker: Email password not set. Use "Time Tracker: Configure Email Settings" command.'
            );
            return false;
        }

        try {
            const todayData = this.storage.getTodayData();
            const aggregates = this.storage.getAggregateTotals();
            const reportData = this.prepareReportData(todayData, aggregates);
            
            if (reportData.totalHours === 0 && reportData.totalMinutes === 0) {
                console.log('Time Tracker: No time tracked today, skipping email');
                return false;
            }

            await this.sendEmail(reportData);
            this.storage.markEmailSent();
            
            vscode.window.showInformationMessage('Time Tracker: Daily report sent successfully!');
            return true;
        } catch (error) {
            console.error('Time Tracker: Failed to send email:', error);
            vscode.window.showErrorMessage(
                `Time Tracker: Failed to send email - ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            return false;
        }
    }

    /**
     * Prepare report data from daily tracking data
     */
    private prepareReportData(data: DailyData, aggregates: AggregateTotals): EmailReportData {
        const totalDuration = formatDuration(data.totalTime);
        const activeDuration = formatDuration(data.activeTime);

        // Prepare repository data
        const repositories: RepoReportData[] = data.repositories
            .sort((a, b) => b.totalTime - a.totalTime)
            .map(repo => {
                const duration = formatDuration(repo.totalTime);
                return {
                    name: repo.repoName,
                    hours: duration.hours,
                    minutes: duration.minutes,
                    branches: repo.branchesWorkedOn,
                    filesCount: repo.filesEdited.length
                };
            });

        // Prepare language data
        const totalLanguageTime = Object.values(data.languages).reduce((a, b) => a + b, 0);
        const languages: LanguageReportData[] = Object.entries(data.languages)
            .sort(([, a], [, b]) => b - a)
            .map(([name, time]) => {
                const duration = formatDuration(time);
                return {
                    name,
                    hours: duration.hours,
                    minutes: duration.minutes,
                    percentage: totalLanguageTime > 0 ? Math.round((time / totalLanguageTime) * 100) : 0
                };
            });

        return {
            date: data.date,
            totalHours: totalDuration.hours,
            totalMinutes: totalDuration.minutes,
            activeHours: activeDuration.hours,
            activeMinutes: activeDuration.minutes,
            repositories,
            languages,
            sessionCount: data.sessions.length,
            aggregates: {
                overall: formatDuration(aggregates.overall),
                weekToDate: formatDuration(aggregates.weekToDate),
                monthToDate: formatDuration(aggregates.monthToDate),
                yearToDate: formatDuration(aggregates.yearToDate)
            }
        };
    }

    /**
     * Send the email using Nodemailer
     */
    private async sendEmail(reportData: EmailReportData): Promise<void> {
        const password = await this.getPassword();
        
        const transporter = nodemailer.createTransport({
            host: this.config.smtpHost,
            port: this.config.smtpPort,
            secure: this.config.smtpPort === 465,
            auth: {
                user: this.config.smtpUser,
                pass: password
            }
        });

        const html = this.generateEmailHtml(reportData);
        const text = this.generateEmailText(reportData);

        await transporter.sendMail({
            from: this.config.smtpUser,
            to: this.config.recipient,
            subject: `VS Code Time Report - ${reportData.date}`,
            text,
            html
        });
    }

    /**
     * Generate HTML email content
     */
    private generateEmailHtml(data: EmailReportData): string {
        const formatTime = (h: number, m: number) => {
            if (h > 0) {return `${h}h ${m}m`;}
            return `${m}m`;
        };

        const repoRows = data.repositories.map(repo => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${repo.name}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${formatTime(repo.hours, repo.minutes)}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${repo.branches.join(', ')}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${repo.filesCount}</td>
            </tr>
        `).join('');

        const languageRows = data.languages.slice(0, 10).map(lang => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${lang.name}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${formatTime(lang.hours, lang.minutes)}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${lang.percentage}%</td>
            </tr>
        `).join('');

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        h1 { color: #0066cc; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
        h2 { color: #444; margin-top: 30px; }
        .summary-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .stat { display: inline-block; margin-right: 30px; margin-bottom: 10px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #0066cc; }
        .stat-label { font-size: 14px; color: #666; }
        .stat-grid { display: flex; flex-wrap: wrap; gap: 12px; }
        .stat-grid .stat { flex: 1 1 45%; min-width: 140px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { background: #0066cc; color: white; padding: 10px; text-align: left; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #888; }
    </style>
</head>
<body>
    <h1>📊 VS Code Daily Report</h1>
    <p><strong>Date:</strong> ${data.date}</p>
    
    <div class="summary-box">
        <div class="stat">
            <div class="stat-value">${formatTime(data.totalHours, data.totalMinutes)}</div>
            <div class="stat-label">Total Time</div>
        </div>
        <div class="stat">
            <div class="stat-value">${formatTime(data.activeHours, data.activeMinutes)}</div>
            <div class="stat-label">Active Coding</div>
        </div>
        <div class="stat">
            <div class="stat-value">${data.sessionCount}</div>
            <div class="stat-label">Sessions</div>
        </div>
    </div>

    <h2>📆 Totals To Date</h2>
    <div class="summary-box stat-grid">
        <div class="stat">
            <div class="stat-value">${formatTime(data.aggregates.weekToDate.hours, data.aggregates.weekToDate.minutes)}</div>
            <div class="stat-label">This Week</div>
        </div>
        <div class="stat">
            <div class="stat-value">${formatTime(data.aggregates.monthToDate.hours, data.aggregates.monthToDate.minutes)}</div>
            <div class="stat-label">This Month</div>
        </div>
        <div class="stat">
            <div class="stat-value">${formatTime(data.aggregates.yearToDate.hours, data.aggregates.yearToDate.minutes)}</div>
            <div class="stat-label">This Year</div>
        </div>
        <div class="stat">
            <div class="stat-value">${formatTime(data.aggregates.overall.hours, data.aggregates.overall.minutes)}</div>
            <div class="stat-label">All Time</div>
        </div>
    </div>

    ${data.repositories.length > 0 ? `
    <h2>📁 Repositories</h2>
    <table>
        <tr>
            <th>Repository</th>
            <th>Time</th>
            <th>Branches</th>
            <th>Files</th>
        </tr>
        ${repoRows}
    </table>
    ` : '<p>No repositories tracked today.</p>'}

    ${data.languages.length > 0 ? `
    <h2>💻 Languages</h2>
    <table>
        <tr>
            <th>Language</th>
            <th>Time</th>
            <th>%</th>
        </tr>
        ${languageRows}
    </table>
    ` : ''}

    <div class="footer">
        <p>Generated by VS Code Time Tracker Extension</p>
    </div>
</body>
</html>
        `;
    }

    /**
     * Generate plain text email content
     */
    private generateEmailText(data: EmailReportData): string {
        const formatTime = (h: number, m: number) => {
            if (h > 0) {return `${h}h ${m}m`;}
            return `${m}m`;
        };

        let text = `VS Code Daily Report - ${data.date}\n`;
        text += '='.repeat(40) + '\n\n';
        
        text += `Total Time: ${formatTime(data.totalHours, data.totalMinutes)}\n`;
        text += `Active Coding: ${formatTime(data.activeHours, data.activeMinutes)}\n`;
        text += `Sessions: ${data.sessionCount}\n\n`;

        text += 'TOTALS TO DATE\n';
        text += '-'.repeat(20) + '\n';
        text += `• This Week: ${formatTime(data.aggregates.weekToDate.hours, data.aggregates.weekToDate.minutes)}\n`;
        text += `• This Month: ${formatTime(data.aggregates.monthToDate.hours, data.aggregates.monthToDate.minutes)}\n`;
        text += `• This Year: ${formatTime(data.aggregates.yearToDate.hours, data.aggregates.yearToDate.minutes)}\n`;
        text += `• All Time: ${formatTime(data.aggregates.overall.hours, data.aggregates.overall.minutes)}\n\n`;

        if (data.repositories.length > 0) {
            text += 'REPOSITORIES\n';
            text += '-'.repeat(20) + '\n';
            for (const repo of data.repositories) {
                text += `• ${repo.name}: ${formatTime(repo.hours, repo.minutes)} (${repo.filesCount} files)\n`;
                text += `  Branches: ${repo.branches.join(', ')}\n`;
            }
            text += '\n';
        }

        if (data.languages.length > 0) {
            text += 'LANGUAGES\n';
            text += '-'.repeat(20) + '\n';
            for (const lang of data.languages.slice(0, 10)) {
                text += `• ${lang.name}: ${formatTime(lang.hours, lang.minutes)} (${lang.percentage}%)\n`;
            }
        }

        return text;
    }

    /**
     * Show configuration dialog
     */
    public async configureEmail(): Promise<void> {
        // Get recipient email
        const recipient = await vscode.window.showInputBox({
            prompt: 'Enter your email address to receive daily reports',
            value: this.config.recipient,
            validateInput: (value) => {
                if (!value || !value.includes('@')) {
                    return 'Please enter a valid email address';
                }
                return null;
            }
        });

        if (!recipient) {
            return;
        }

        // Get SMTP user
        const smtpUser = await vscode.window.showInputBox({
            prompt: 'Enter SMTP username (your sending email address)',
            value: this.config.smtpUser || recipient,
            validateInput: (value) => {
                if (!value || !value.includes('@')) {
                    return 'Please enter a valid email address';
                }
                return null;
            }
        });

        if (!smtpUser) {
            return;
        }

        // Get SMTP password
        const password = await vscode.window.showInputBox({
            prompt: 'Enter SMTP password (or Gmail App Password)',
            password: true,
            validateInput: (value) => {
                if (!value || value.length < 4) {
                    return 'Please enter a valid password';
                }
                return null;
            }
        });

        if (!password) {
            return;
        }

        // Save settings
        const config = vscode.workspace.getConfiguration('timeTracker.email');
        await config.update('recipient', recipient, vscode.ConfigurationTarget.Global);
        await config.update('smtpUser', smtpUser, vscode.ConfigurationTarget.Global);
        await this.setPassword(password);

        vscode.window.showInformationMessage(
            'Time Tracker: Email configured successfully! A test email will be sent.'
        );

        // Reload config
        this.config = this.loadConfig();

        // Send test email
        await this.sendTestEmail();
    }

    /**
     * Send a test email
     */
    private async sendTestEmail(): Promise<void> {
        try {
            const password = await this.getPassword();
            
            const transporter = nodemailer.createTransport({
                host: this.config.smtpHost,
                port: this.config.smtpPort,
                secure: this.config.smtpPort === 465,
                auth: {
                    user: this.config.smtpUser,
                    pass: password
                }
            });

            await transporter.sendMail({
                from: this.config.smtpUser,
                to: this.config.recipient,
                subject: 'VS Code Time Tracker - Configuration Successful',
                text: 'Your VS Code Time Tracker is now configured to send daily reports!\n\nYou will receive a summary of your coding activity each day.',
                html: `
                    <h1>🎉 Configuration Successful!</h1>
                    <p>Your VS Code Time Tracker is now configured to send daily reports!</p>
                    <p>You will receive a summary of your coding activity each day at ${this.config.sendTime}.</p>
                `
            });

            vscode.window.showInformationMessage('Time Tracker: Test email sent successfully!');
        } catch (error) {
            vscode.window.showErrorMessage(
                `Time Tracker: Failed to send test email - ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Send report on VS Code close (if enabled and not already sent)
     */
    public async sendOnClose(): Promise<void> {
        if (!this.config.sendOnClose) {
            return;
        }

        await this.sendDailyReport();
    }

    /**
     * Dispose and clean up
     */
    public dispose(): void {
        if (this.scheduledTimeout) {
            clearTimeout(this.scheduledTimeout);
            this.scheduledTimeout = null;
        }
    }
}
