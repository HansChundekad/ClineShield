/**
 * MetricsSidebarProvider.ts
 *
 * The sidebar webview: Waiting on you, totals, recent activity, settings.
 * I/O and messaging only; the model is dashboard.ts, the config line
 * configView.ts, explanations explain.ts. Messages from the webview are
 * validated: unknown types and ids not in the current dashboard are ignored.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { readEvents } from '../metrics/reader';
import { selectVisibleSessionIds } from '../metrics/sessions';
import { buildDashboard } from './dashboard';
import type { ActionItem, Dashboard } from './dashboard';
import { readConfigSummary } from '../config/configView';
import type { ConfigSummary } from '../config/configView';
import { createConfigFromTemplate, isPluginInstalled } from '../config/setup';
import { CONFIG_FILE } from '../plugin/config/store';
import type { ConfigStore } from '../plugin/config/store';
import { createExplainer } from '../extension/riskAnalysis/explain';
import type { GeminiResult } from '../extension/riskAnalysis/llmAnalyzer';

export const GEMINI_KEY_SECRET = 'clineshield.geminiApiKey';
const INSTALL_COMMAND = 'cline plugin install https://github.com/HansChundekad/ClineShield';
const HELP_URL = 'https://github.com/HansChundekad/ClineShield#configuration';
const REFRESH_DEBOUNCE_MS = 50;

type Explanation = { state: 'loading' | 'done' | 'error'; text: string };

export interface SidebarOptions {
  extensionUri: vscode.Uri;
  metricsRoot: string | undefined;
  workspaceRoot: string | undefined;
  sessionId: string;
  activationTime: number;
  homeDir: string;
  secrets: vscode.SecretStorage;
  configStore: ConfigStore;
  onWaitingCount: (n: number) => void;
}

export class MetricsSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'clineshield.metricsView';

  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly dismissed = new Set<string>();
  private readonly explanations: Record<string, Explanation> = {};
  private dashboard: Dashboard | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly explain: (item: ActionItem) => Promise<GeminiResult>;

  constructor(private readonly opts: SidebarOptions) {
    this.explain = opts.metricsRoot
      ? createExplainer({ root: opts.metricsRoot, getKey: () => this.getKey() })
      : async () => ({ ok: false, error: 'no workspace' });
    if (opts.metricsRoot) {
      // Atomic writes (temp + rename) fire onDidCreate on macOS, not onDidChange.
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(opts.metricsRoot), '.cline-shield/metrics.json'));
      watcher.onDidChange(() => this.refresh());
      watcher.onDidCreate(() => this.refresh());
      this.disposables.push(watcher);
    }
    this.refresh();
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = await this.html(webviewView.webview);
    this.disposables.push(webviewView.webview.onDidReceiveMessage(m => void this.onMessage(m)));
    webviewView.onDidDispose(() => { this.view = undefined; });
  }

  /** Debounced: a burst of metrics.json writes triggers one read. */
  refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.update(); }, REFRESH_DEBOUNCE_MS);
  }

  private async getKey(): Promise<string | undefined> {
    return (await this.opts.secrets.get(GEMINI_KEY_SECRET)) || undefined;
  }

  private async update(): Promise<void> {
    try {
      const events = this.opts.metricsRoot ? await readEvents(this.opts.metricsRoot) : [];
      const visible = selectVisibleSessionIds(events, this.opts.activationTime, this.opts.sessionId);
      this.dashboard = buildDashboard(events, visible, this.dismissed);
      this.opts.onWaitingCount(this.dashboard.waiting.length);
      await this.post();
    } catch (error) {
      console.error('[ClineShield] sidebar update failed:', (error as Error)?.message ?? error);
    }
  }

  private async post(): Promise<void> {
    if (!this.view || !this.dashboard) return;
    const dashboard = this.dashboard;
    const [config, hasKey, pluginInstalled] = await Promise.all([
      readConfigSummary(this.opts.configStore, this.opts.homeDir),
      this.getKey().then(Boolean),
      dashboard.hasEvents ? Promise.resolve(true) : isPluginInstalled(this.opts.homeDir, this.opts.workspaceRoot),
    ]);
    const message: { type: 'update'; dashboard: Dashboard; config: ConfigSummary; hasKey: boolean; pluginInstalled: boolean; explanations: Record<string, Explanation> } =
      { type: 'update', dashboard, config, hasKey, pluginInstalled, explanations: { ...this.explanations } };
    void this.view?.webview.postMessage(message);
  }

  private findItem(id: unknown): ActionItem | undefined {
    if (typeof id !== 'string' || !this.dashboard) return undefined;
    return [...this.dashboard.waiting, ...this.dashboard.recent].find(i => i.id === id);
  }

  private async onMessage(m: unknown): Promise<void> {
    if (typeof m !== 'object' || m === null) return;
    const { type, id } = m as { type?: unknown; id?: unknown };
    const configUri = vscode.Uri.file(path.join(this.opts.homeDir, CONFIG_FILE));
    switch (type) {
      case 'ready': return this.update();
      case 'dismiss': {
        const item = this.findItem(id);
        if (item) { this.dismissed.add(item.id); await this.update(); }
        return;
      }
      case 'explain': {
        const item = this.findItem(id);
        if (item) await this.runExplain(item);
        return;
      }
      case 'setKey': await vscode.commands.executeCommand('clineshield.setGeminiKey'); return;
      case 'clearKey': await vscode.commands.executeCommand('clineshield.clearGeminiKey'); return;
      case 'openConfig': await vscode.window.showTextDocument(configUri); return;
      case 'createConfig': {
        const choice = await vscode.window.showInformationMessage(
          'Create ~/.cline-shield.yml from the ClineShield template?', { modal: true }, 'Create');
        if (choice !== 'Create') return;
        const result = await createConfigFromTemplate(this.opts.homeDir);
        if (result === 'failed') { void vscode.window.showErrorMessage('ClineShield: could not create ~/.cline-shield.yml.'); return; }
        await vscode.window.showTextDocument(configUri);
        this.refresh();
        return;
      }
      case 'help': await vscode.env.openExternal(vscode.Uri.parse(HELP_URL)); return;
      case 'copyInstall':
        await vscode.env.clipboard.writeText(INSTALL_COMMAND);
        void vscode.window.showInformationMessage('ClineShield: install command copied.');
        return;
      default: return;
    }
  }

  private async runExplain(item: ActionItem): Promise<void> {
    if (!(await this.getKey())) {
      await vscode.commands.executeCommand('clineshield.setGeminiKey');
      if (!(await this.getKey())) return;
    }
    this.explanations[item.id] = { state: 'loading', text: '' };
    await this.post();
    const result = await this.explain(item);
    this.explanations[item.id] = result.ok
      ? { state: 'done', text: result.explanation }
      : { state: 'error', text: result.error === 'no-key' ? 'Set a Gemini key to get explanations.' : `Gemini request failed: ${result.error}` };
    await this.post();
  }

  private async html(webview: vscode.Webview): Promise<string> {
    const nonce = randomBytes(16).toString('base64');
    try {
      const raw = await fs.readFile(path.join(this.opts.extensionUri.fsPath, 'src', 'sidebar', 'metrics.html'), 'utf-8');
      return raw.split('{{nonce}}').join(nonce).split('{{cspSource}}').join(webview.cspSource);
    } catch {
      return '<!DOCTYPE html><html><body><p>Failed to load the ClineShield sidebar.</p></body></html>';
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}
