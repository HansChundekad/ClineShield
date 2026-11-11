import * as vscode from 'vscode';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { appendEvent } from './metrics/writer';
import { resolveMetricsRoot } from './metrics/metricsRoot';
import { testEvents } from './metrics/testEvents';
import { GEMINI_KEY_SECRET, MetricsSidebarProvider } from './sidebar/MetricsSidebarProvider';
import { ChangeMapProvider } from './changeMap/ChangeMapProvider';
import { ConfigStore, CONFIG_FILE } from './plugin/config/store';

/**
 * ClineShield VS Code extension: an optional dashboard over the plugin's
 * .cline-shield/metrics.json. Read-only toward the log (except the dev
 * command "Generate Test Metrics") and toward ~/.cline-shield.yml (except
 * "Create config", which only creates a missing file after confirmation).
 *
 * Sessions (Decision 7): dashboards show every session whose session-start is
 * at or after activation, plus this extension's own id (kept in memory only).
 */

let currentSessionId: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  // The plugin logs to the git root, which can be above the opened folder.
  const metricsRoot = workspaceRoot ? await resolveMetricsRoot(workspaceRoot) : undefined;
  const activationTime = Date.now();
  currentSessionId = randomUUID();
  const sessionId = currentSessionId;
  const homeDir = os.homedir();

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'workbench.view.extension.clineshield';
  const setWaiting = (n: number) => {
    statusBar.text = n > 0 ? `$(shield) ClineShield · ${n} waiting` : '$(shield) ClineShield';
    statusBar.tooltip = n > 0 ? `ClineShield: ${n} waiting on you` : 'ClineShield: nothing waiting on you';
  };
  setWaiting(0);
  statusBar.show();
  context.subscriptions.push(statusBar);

  const sidebar = new MetricsSidebarProvider({
    extensionUri: context.extensionUri, metricsRoot, workspaceRoot, sessionId, activationTime, homeDir,
    secrets: context.secrets, configStore: new ConfigStore({ homeDir }), onWaitingCount: setWaiting,
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(MetricsSidebarProvider.viewType, sidebar), sidebar);

  if (metricsRoot) {
    const changeMap = new ChangeMapProvider(metricsRoot, sessionId, activationTime);
    context.subscriptions.push(vscode.window.registerTreeDataProvider(ChangeMapProvider.viewType, changeMap), changeMap);
  }

  // ~/.cline-shield.yml is outside the workspace; Reload Config is the fallback if this watcher misses a save.
  const configWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(homeDir), CONFIG_FILE));
  configWatcher.onDidCreate(() => sidebar.refresh());
  configWatcher.onDidChange(() => sidebar.refresh());
  configWatcher.onDidDelete(() => sidebar.refresh());
  context.subscriptions.push(configWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('clineshield.reloadConfig', () => {
      sidebar.refresh();
      void vscode.window.showInformationMessage('ClineShield: config reloaded.');
    }),
    vscode.commands.registerCommand('clineshield.setGeminiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'ClineShield: Set Gemini API Key',
        prompt: 'Used only when you click Explain. Stored in VS Code secret storage, never in a file.',
        password: true, ignoreFocusOut: true,
        validateInput: v => (v.trim() ? undefined : 'Paste a Gemini API key'),
      });
      if (!key?.trim()) return;
      await context.secrets.store(GEMINI_KEY_SECRET, key.trim());
      sidebar.refresh();
      void vscode.window.showInformationMessage('ClineShield: Gemini key saved. Explanations are on.');
    }),
    vscode.commands.registerCommand('clineshield.clearGeminiKey', async () => {
      await context.secrets.delete(GEMINI_KEY_SECRET);
      sidebar.refresh();
      void vscode.window.showInformationMessage('ClineShield: Gemini key cleared. Explanations are off.');
    }),
    context.secrets.onDidChange(e => { if (e.key === GEMINI_KEY_SECRET) sidebar.refresh(); }),
    vscode.commands.registerCommand('clineshield.generateTestMetrics', async () => {
      if (!metricsRoot) {
        void vscode.window.showWarningMessage('ClineShield: no workspace open.');
        return;
      }
      const events = testEvents(sessionId, Date.now());
      for (const event of events) await appendEvent(event, metricsRoot);
      void vscode.window.showInformationMessage(`ClineShield: generated ${events.length} test events.`);
    }),
  );
}

export function deactivate(): void {
  currentSessionId = undefined;
}
