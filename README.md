# VS Code Time Tracker Extension

A VS Code extension that automatically tracks your coding time, monitors repositories you work on, and sends daily email summaries.

## Features

- **Automatic Time Tracking**: Starts tracking automatically when VS Code opens
- **Active vs Idle Detection**: Distinguishes between active coding and idle time
- **Repository Tracking**: Automatically detects Git repositories and tracks time per project
- **Branch Tracking**: Tracks which branches you work on
- **Language Statistics**: Monitors time spent in different programming languages
- **Daily Email Reports**: Sends beautiful HTML email summaries of your daily coding activity
- **Status Bar Integration**: Shows today's tracked time in the status bar
- **Detailed Statistics Panel**: View comprehensive statistics in a WebView panel

## Installation

### From Source (Development)

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to compile TypeScript
4. Press `F5` to launch a new VS Code window with the extension loaded

### Package and Install

1. Install vsce: `npm install -g @vscode/vsce`
2. Package: `vsce package`
3. Install the generated `.vsix` file in VS Code

## Configuration

Open VS Code settings and search for "Time Tracker" to configure:

### Email Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `timeTracker.email.enabled` | Enable daily email reports | `true` |
| `timeTracker.email.recipient` | Email address to receive reports | `""` |
| `timeTracker.email.smtpHost` | SMTP server hostname | `smtp.gmail.com` |
| `timeTracker.email.smtpPort` | SMTP server port | `587` |
| `timeTracker.email.smtpUser` | SMTP username/email | `""` |
| `timeTracker.email.sendTime` | Time to send daily report (HH:MM) | `18:00` |
| `timeTracker.email.sendOnClose` | Send report when VS Code closes | `true` |

### Tracking Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `timeTracker.tracking.idleThresholdMinutes` | Minutes before marking as idle | `3` |
| `timeTracker.tracking.heartbeatIntervalSeconds` | Activity check interval | `30` |

## Setting Up Email (Gmail)

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable 2-Step Verification
3. Generate an App Password:
   - Go to Security → 2-Step Verification → App passwords
   - Select "Mail" and your device
   - Copy the generated 16-character password
4. Run command: `Time Tracker: Configure Email Settings`
5. Enter your email and the app password

## Commands

| Command | Description |
|---------|-------------|
| `Time Tracker: Show Statistics` | Open detailed statistics panel |
| `Time Tracker: Send Email Report Now` | Manually send today's report |
| `Time Tracker: Configure Email Settings` | Set up email configuration |
| `Time Tracker: Reset Today's Data` | Clear today's tracking data |

## Data Storage

Tracking data is stored in JSON files in VS Code's global storage directory:
- Windows: `%APPDATA%\Code\User\globalStorage\aamir.vscode-time-tracker\`
- macOS: `~/Library/Application Support/Code/User/globalStorage/aamir.vscode-time-tracker/`
- Linux: `~/.config/Code/User/globalStorage/aamir.vscode-time-tracker/`

Data older than 90 days is automatically cleaned up.

## Privacy

- All data is stored locally on your machine
- Email credentials are stored securely in VS Code's secret storage
- No data is sent to external servers (except for your configured email service)

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Run extension in debug mode
Press F5 in VS Code
```

## License

MIT
