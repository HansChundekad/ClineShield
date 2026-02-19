import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readEventsBySession } from '../metrics/reader';
import type { MetricsEvent } from '../types/metrics';

interface SidebarStats {
  blockedEdits: number;
  allowedEdits: number;
  passedEdits: number;
  failedEdits: number;
  avgRetries: number;
  mostRecent: {
    file: string;
    eventType: string;
    timestamp: string;
    riskScore: number | null;
    riskLevel: 'low' | 'medium' | 'high' | null;
    riskReasons: Array<{ description: string; points: number }> | null;
  } | null;
}

export class MetricsSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'clineshield.metricsView';

  private view?: vscode.WebviewView;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceRoot: string,
    private readonly sessionId: string
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      '**/.cline-shield/metrics.json'
    );

    this.watcher.onDidChange(() => this.refresh());
    this.watcher.onDidCreate(() => this.refresh());

    this.disposables.push(this.watcher);
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = await this.getHtmlContent();

    // Send initial stats
    await this.refresh();

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const stats = await this.calculateStats();

    this.view.webview.postMessage({
      type: 'update',
      stats,
    });
  }

  private async calculateStats(): Promise<SidebarStats> {
    const events = await readEventsBySession(this.sessionId, this.workspaceRoot);

    const blockedEdits = events.filter(e => e.type === 'edit-blocked').length;

    // Exclude the synthetic 'session-start' marker written on activation
    const allowedEdits = events.filter(
      e => e.type === 'edit-allowed' && (e.data as { file?: string }).file !== 'session-start'
    ).length;

    const passedEdits = events.filter(e => e.type === 'sanity-passed').length;

    const sanityFailed = events.filter(
      (e): e is Extract<MetricsEvent, { type: 'sanity-failed' }> =>
        e.type === 'sanity-failed'
    );
    const failedEdits = sanityFailed.length;

    // Average max retryCount per unique file (= how many attempts each file needed)
    let avgRetries = 0;
    if (sanityFailed.length > 0) {
      const maxPerFile = new Map<string, number>();
      for (const e of sanityFailed) {
        const file = e.data.file;
        maxPerFile.set(file, Math.max(maxPerFile.get(file) ?? 0, e.data.retryCount));
      }
      const totals = [...maxPerFile.values()];
      avgRetries = Math.round((totals.reduce((s, n) => s + n, 0) / totals.length) * 10) / 10;
    }

    // Most recent edit: only edit-allowed / edit-blocked events, so that
    // risk-assessed and sanity events don't overwrite the panel.
    const editEvents = events.filter(
      e => e.type === 'edit-allowed' || e.type === 'edit-blocked'
    );
    const lastEdit = editEvents[editEvents.length - 1] ?? null;

    let mostRecent: SidebarStats['mostRecent'] = null;
    if (lastEdit) {
      const file = (lastEdit.data as { file?: string }).file ?? 'unknown';

      // Find the most recent risk-assessed event for this file that was written
      // after (or at the same time as) the edit — links score to this specific edit.
      let riskScore: number | null = null;
      let riskLevel: 'low' | 'medium' | 'high' | null = null;
      let riskReasons: Array<{ description: string; points: number }> | null = null;

      if (lastEdit.type === 'edit-allowed') {
        const riskEvent = [...events]
          .reverse()
          .find(
            e =>
              e.type === 'risk-assessed' &&
              (e.data as { file?: string }).file === file &&
              e.timestamp >= lastEdit.timestamp
          );
        if (riskEvent?.type === 'risk-assessed') {
          const d = riskEvent.data as {
            rulesScore: number;
            level: 'low' | 'medium' | 'high';
            reasons: Array<{ rule: string; points: number; description: string }>;
          };
          riskScore = d.rulesScore;
          riskLevel = d.level;
          riskReasons = d.reasons.map(r => ({ description: r.description, points: r.points }));
        }
      }

      mostRecent = { file, eventType: lastEdit.type, timestamp: lastEdit.timestamp, riskScore, riskLevel, riskReasons };
    }

    return { blockedEdits, allowedEdits, passedEdits, failedEdits, avgRetries, mostRecent };
  }

  private async getHtmlContent(): Promise<string> {
    const htmlPath = path.join(
      this.extensionUri.fsPath,
      'src',
      'sidebar',
      'metrics.html'
    );

    try {
      return await fs.readFile(htmlPath, 'utf-8');
    } catch {
      return `<html><body><p>Failed to load sidebar UI.</p></body></html>`;
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
