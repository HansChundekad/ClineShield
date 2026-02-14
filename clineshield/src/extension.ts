import * as vscode from 'vscode';

/**
 * Extension activation function
 * Called when the extension is activated (on VS Code startup)
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('ClineShield extension is now active');

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
