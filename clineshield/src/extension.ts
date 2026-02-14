import * as vscode from 'vscode';
import { randomUUID } from 'crypto';

/**
 * Extension activation function
 * Called when the extension is activated (on VS Code startup)
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('ClineShield extension is now active');

  // Register command: ClineShield: Activate
  const activateCommand = vscode.commands.registerCommand('clineshield.activate', async () => {
    // Generate UUID for session
    const sessionId = randomUUID();

    // Store sessionId in global state
    await context.globalState.update('sessionId', sessionId);

    // Log sessionId to console
    console.log(`ClineShield session ID: ${sessionId}`);

    // Show info notification
    vscode.window.showInformationMessage(`ClineShield activated! Session: ${sessionId}`);
  });

  // Add command to subscriptions for cleanup
  context.subscriptions.push(activateCommand);

  // Future: Initialize components here
  // - Metrics file watcher
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
