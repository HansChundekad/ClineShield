import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { appendEvent } from './metrics/writer';
import { readEventsBySession } from './metrics/reader';
import { MetricsSidebarProvider } from './sidebar/MetricsSidebarProvider';

// Store current session ID at module level for file watcher access
let currentSessionId: string | undefined;

/**
 * Extension activation function
 * Called when the extension is activated (on VS Code startup)
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('ClineShield extension is now active');

  // Generate fresh session ID on each activation (no persistence)
  currentSessionId = randomUUID();
  console.log(`ClineShield session ID: ${currentSessionId}`);

  // Set environment variable for hooks to access sessionId
  process.env.CLINESHIELD_SESSION_ID = currentSessionId;

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '🛡️ ClineShield';
  statusBarItem.tooltip = `Session: ${currentSessionId} | Events: 0`;

  // Show status bar item immediately
  statusBarItem.show();

  // Add status bar item to subscriptions for cleanup
  context.subscriptions.push(statusBarItem);

  // Write initial session-start event to metrics.json
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    void appendEvent(
      {
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId ?? 'unknown-session',
        type: 'edit-allowed',
        data: {
          file: 'session-start',
          structuralChangePercent: 0,
          functionsDeleted: 0,
          exportsDeleted: 0,
        },
      },
      workspaceRoot
    ).then(() => {
      console.log('Session-start event written to metrics.json');
    }).catch((error) => {
      console.error('Failed to write session-start event:', error);
    });
  } else {
    console.warn('No workspace folder found, skipping session-start event');
  }

  // Register command: ClineShield: Deactivate (stub for Phase 3)
  const deactivateCommand = vscode.commands.registerCommand('clineshield.deactivate', async () => {
    // TODO: Phase 3 - Implement full deactivation:
    // - Disable hook scripts
    // - Stop file watcher
    // - Hide UI elements
    // - Write session-end event
    vscode.window.showInformationMessage(
      'ClineShield deactivate - Full implementation coming in Phase 3'
    );
  });

  // Add deactivate command to subscriptions
  context.subscriptions.push(deactivateCommand);

  // Create file watcher for metrics.json
  const metricsWatcher = vscode.workspace.createFileSystemWatcher(
    '**/.cline-shield/metrics.json'
  );

  // Register onDidChange callback
  metricsWatcher.onDidChange(async () => {
    try {
      console.log('Metrics file changed');

      // Use module-level session ID
      if (!currentSessionId) {
        console.log('No session ID found, skipping event read');
        return;
      }

      // Read events for current session
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        console.log('No workspace folder found, skipping event read');
        return;
      }

      const events = await readEventsBySession(currentSessionId, workspaceRoot);
      console.log(`Found ${events.length} events for session ${currentSessionId}`);

      // Update status bar tooltip with event count
      statusBarItem.tooltip = `Session: ${currentSessionId} | Events: ${events.length}`;
    } catch (error) {
      console.error('Error reading metrics events:', error);
    }
  });

  // Add watcher to subscriptions for cleanup
  context.subscriptions.push(metricsWatcher);

  // Register Metrics Sidebar
  if (workspaceRoot) {
    const sidebarProvider = new MetricsSidebarProvider(
      context.extensionUri,
      workspaceRoot
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        MetricsSidebarProvider.viewType,
        sidebarProvider
      )
    );

    context.subscriptions.push(sidebarProvider);
  }

  // Test command: Generate mock metrics
  const generateTestMetrics = vscode.commands.registerCommand(
    'clineshield.generateTestMetrics',
    async () => {
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const now = Date.now();
      const testEvents = [
        { type: 'edit-blocked', mins: 25, file: 'src/auth.ts', reason: 'Would delete 5 functions' },
        { type: 'edit-blocked', mins: 20, file: 'src/database.ts', reason: 'Structural change 80%' },
        { type: 'edit-blocked', mins: 15, file: 'src/api.ts', reason: 'Would delete 3 exports' },
        { type: 'sanity-passed', mins: 28, file: 'src/utils.ts' },
        { type: 'sanity-passed', mins: 22, file: 'src/config.ts' },
        { type: 'sanity-passed', mins: 18, file: 'src/helper.ts' },
        { type: 'sanity-passed', mins: 10, file: 'src/format.ts' },
        { type: 'sanity-passed', mins: 5, file: 'src/validator.ts' },
        { type: 'sanity-failed', mins: 12, file: 'src/buggy.ts', retryCount: 1 },
        { type: 'sanity-failed', mins: 3, file: 'src/messy.ts', retryCount: 2 },
      ];

      for (const evt of testEvents) {
        const timestamp = new Date(now - evt.mins * 60 * 1000).toISOString();

        await appendEvent(
          {
            timestamp,
            sessionId: currentSessionId || 'test-session',
            type: evt.type as any,
            data: {
              file: evt.file,
              ...(evt.retryCount !== undefined ? { retryCount: evt.retryCount } : {}),
              ...(evt.reason ? { reason: evt.reason } : {}),
            } as any,
          },
          workspaceRoot
        );
      }

      vscode.window.showInformationMessage('Generated 10 test metrics events');
    }
  );

  context.subscriptions.push(generateTestMetrics);

  // Future: Initialize components here
  // - Hook generators
  // - Config loader (Phase 3)
}

/**
 * Extension deactivation function
 * Called when the extension is deactivated
 *
 * Note: Resources added to context.subscriptions are automatically disposed
 */
export function deactivate(): void {
  console.log('ClineShield extension deactivated');

  // Clear session ID from module scope and environment
  currentSessionId = undefined;
  delete process.env.CLINESHIELD_SESSION_ID;

  // All disposables in context.subscriptions are cleaned up automatically:
  // - Status bar item
  // - File watcher
  // - Command registrations
}
