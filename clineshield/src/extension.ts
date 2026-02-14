import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { appendEvent } from './metrics/writer';
import { readEventsBySession } from './metrics/reader';

/**
 * Extension activation function
 * Called when the extension is activated (on VS Code startup)
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('ClineShield extension is now active');

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '🛡️ ClineShield Active';

  // Check for existing session ID and set tooltip
  const existingSessionId = context.globalState.get<string>('sessionId');
  if (existingSessionId) {
    statusBarItem.tooltip = `Session: ${existingSessionId} | Click for details`;
  } else {
    statusBarItem.tooltip = 'No active session | Click for details';
  }

  // Show status bar item immediately
  statusBarItem.show();

  // Add status bar item to subscriptions for cleanup
  context.subscriptions.push(statusBarItem);

  // Register command: ClineShield: Activate
  const activateCommand = vscode.commands.registerCommand('clineshield.activate', async () => {
    // Generate UUID for session
    const sessionId = randomUUID();

    // Store sessionId in global state
    await context.globalState.update('sessionId', sessionId);

    // Update status bar tooltip with new session ID
    statusBarItem.tooltip = `Session: ${sessionId} | Click for details`;

    // Log sessionId to console
    console.log(`ClineShield session ID: ${sessionId}`);

    // Write a test event to metrics.json
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      await appendEvent(
        {
          timestamp: new Date().toISOString(),
          sessionId,
          type: 'edit-allowed',
          data: {
            file: 'test-file.ts',
            structuralChangePercent: 0,
            functionsDeleted: 0,
            exportsDeleted: 0,
          },
        },
        workspaceRoot
      );
      console.log('Test event written to metrics.json');
    }

    // Show info notification
    vscode.window.showInformationMessage(`ClineShield activated! Session: ${sessionId}`);
  });

  // Add command to subscriptions for cleanup
  context.subscriptions.push(activateCommand);

  // Create file watcher for metrics.json
  const metricsWatcher = vscode.workspace.createFileSystemWatcher(
    '**/.cline-shield/metrics.json'
  );

  // Register onDidChange callback
  metricsWatcher.onDidChange(async () => {
    console.log('Metrics file changed');

    // Get current session ID
    const sessionId = context.globalState.get<string>('sessionId');
    if (!sessionId) {
      console.log('No session ID found, skipping event read');
      return;
    }

    // Read events for current session
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      console.log('No workspace folder found, skipping event read');
      return;
    }

    const events = await readEventsBySession(sessionId, workspaceRoot);
    console.log(`Found ${events.length} events for session ${sessionId}`);

    // Update status bar tooltip with event count
    statusBarItem.tooltip = `Session: ${sessionId} | ${events.length} events | Click for details`;
  });

  // Add watcher to subscriptions for cleanup
  context.subscriptions.push(metricsWatcher);

  // Future: Initialize components here
  // - Hook generators
  // - Sidebar/UI providers
}

/**
 * Extension deactivation function
 * Called when the extension is deactivated
 */
export function deactivate(): void {
  console.log('ClineShield extension is now deactivated');

  // Future: Cleanup resources here
}
