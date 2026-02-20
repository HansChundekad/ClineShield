import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { loadConfig } from './config/configLoader';
import { appendEvent } from './metrics/writer';
import { readEventsBySession } from './metrics/reader';
import { MetricsSidebarProvider } from './sidebar/MetricsSidebarProvider';
import { ChangeMapProvider } from './changeMap/ChangeMapProvider';
import { processRiskEvent } from './extension/riskAnalysis/llmTrigger';

// Store current session ID at module level for file watcher access
let currentSessionId: string | undefined;

// Tracks risk-assessed event timestamps already sent to Gemini this session.
// Prevents re-triggering when subsequent metrics.json writes fire the watcher.
const processedRiskTimestamps = new Set<string>();

// Gemini free tier: 10 RPM → 1 call per 6 s to stay safely under the limit.
const GEMINI_MIN_INTERVAL_MS = 6000;
let geminiLastCallMs = 0;
const geminiQueue: Array<() => void> = [];
let geminiDraining = false;

function enqueueGeminiCall(fn: () => void): void {
  geminiQueue.push(fn);
  if (!geminiDraining) {
    void drainGeminiQueue();
  }
}

async function drainGeminiQueue(): Promise<void> {
  geminiDraining = true;
  while (geminiQueue.length > 0) {
    const fn = geminiQueue.shift()!;
    const wait = GEMINI_MIN_INTERVAL_MS - (Date.now() - geminiLastCallMs);
    if (wait > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, wait));
    }
    geminiLastCallMs = Date.now();
    fn();
  }
  geminiDraining = false;
}

/**
 * Extension activation function
 * Called when the extension is activated (on VS Code startup)
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('ClineShield extension is now active');

  // Load YAML config first so env vars are set before hooks run
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    loadConfig(workspaceRoot);
  }

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
  if (workspaceRoot) {
    void appendEvent(
      {
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
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

  // Register command: ClineShield: Reload Configuration
  const reloadConfigCommand = vscode.commands.registerCommand('clineshield.reloadConfig', () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showWarningMessage('ClineShield: No workspace open — cannot reload config.');
      return;
    }
    loadConfig(root);
    vscode.window.showInformationMessage('ClineShield: Configuration reloaded.');
  });

  context.subscriptions.push(reloadConfigCommand);

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

  // Atomic writes (write-temp + rename) fire onDidCreate on macOS, not onDidChange.
  // Wire both events to the same handler so neither path is missed.
  const handleMetricsChange = async (uri: vscode.Uri, eventName: string) => {
    try {
      console.log(`[CS:watcher] ${eventName} fired — uri:${uri.fsPath}`);

      // Use module-level session ID
      if (!currentSessionId) {
        console.log('[CS:watcher] no sessionId — skipping');
        return;
      }

      // Read events for current session
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        console.log('[CS:watcher] no workspaceRoot — skipping');
        return;
      }

      const events = await readEventsBySession(currentSessionId, workspaceRoot);

      // Update status bar tooltip with event count
      statusBarItem.tooltip = `Session: ${currentSessionId} | Events: ${events.length}`;

      // Fire LLM analysis for any new medium/high risk-assessed events
      for (const event of events) {
        if (
          event.type === 'risk-assessed' &&
          event.data.level !== 'low' &&
          !processedRiskTimestamps.has(event.timestamp)
        ) {
          processedRiskTimestamps.add(event.timestamp);
          console.log(`[CS:llm] enqueuing Gemini call — level:${event.data.level} score:${event.data.rulesScore} file:${event.data.file}`);
          enqueueGeminiCall(() => void processRiskEvent(event, currentSessionId!, workspaceRoot));
        }
      }
    } catch (error) {
      console.error('Error reading metrics events:', error);
    }
  };

  metricsWatcher.onDidChange((uri) => void handleMetricsChange(uri, 'onDidChange'));
  metricsWatcher.onDidCreate((uri) => void handleMetricsChange(uri, 'onDidCreate'));

  // Add watcher to subscriptions for cleanup
  context.subscriptions.push(metricsWatcher);

  // Register metrics sidebar
  if (workspaceRoot) {
    const sidebarProvider = new MetricsSidebarProvider(context.extensionUri, workspaceRoot, currentSessionId);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(MetricsSidebarProvider.viewType, sidebarProvider)
    );
    context.subscriptions.push(sidebarProvider);
  }

  // Register change map tree view
  if (workspaceRoot) {
    const changeMapProvider = new ChangeMapProvider(workspaceRoot, currentSessionId);
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(ChangeMapProvider.viewType, changeMapProvider)
    );
    context.subscriptions.push(changeMapProvider);
  }

  // Register command: ClineShield: Generate Test Metrics
  const generateTestMetricsCommand = vscode.commands.registerCommand('clineshield.generateTestMetrics', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !currentSessionId) {
      vscode.window.showWarningMessage('ClineShield: No workspace open.');
      return;
    }
    const now = Date.now();
    const ts = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
    await appendEvent({ timestamp: ts(4), sessionId: currentSessionId, type: 'edit-blocked',  data: { file: 'src/auth.ts', reason: 'Too many deletions', structuralChangePercent: 80, functionsDeleted: 4, exportsDeleted: 1 } }, root);
    await appendEvent({ timestamp: ts(3), sessionId: currentSessionId, type: 'edit-allowed',  data: { file: 'src/api.ts',  structuralChangePercent: 10, functionsDeleted: 0, exportsDeleted: 0 } }, root);
    await appendEvent({ timestamp: ts(2), sessionId: currentSessionId, type: 'sanity-passed', data: { file: 'src/api.ts',  tools: ['prettier', 'eslint', 'tsc'], duration: 3 } }, root);
    await appendEvent({ timestamp: ts(1), sessionId: currentSessionId, type: 'sanity-failed', data: { file: 'src/auth.ts', tool: 'eslint', errors: ["Line 12: 'x' is defined but never used"], retryCount: 1, maxRetries: 3 } }, root);
    await appendEvent({ timestamp: ts(0), sessionId: currentSessionId, type: 'edit-allowed',  data: { file: 'src/utils.ts', structuralChangePercent: 5, functionsDeleted: 0, exportsDeleted: 0 } }, root);
    vscode.window.showInformationMessage('ClineShield: Generated 5 test metrics events.');
  });
  context.subscriptions.push(generateTestMetricsCommand);
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
