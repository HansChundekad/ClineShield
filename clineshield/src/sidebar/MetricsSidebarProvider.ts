import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readEvents } from '../metrics/reader';
import type { MetricsEvent } from '../types/metrics';

interface SidebarStats {
  blockedEdits: number;
  passedEdits: number;
  failedEdits: number;
  avgRetries: number;
  mostRecent: {
    file: string;
    eventType: string;
    timestamp: string;
  } | null;
}

export class MetricsSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'clineshield.metricsView';

  private view?: vscode.WebviewView;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceRoot: string
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
    const events = await readEvents(this.workspaceRoot);

    const blockedEdits = events.filter(e => e.type === 'edit-blocked').length;
    const passedEdits = events.filter(e => e.type === 'sanity-passed').length;

    const sanityFailed = events.filter(
      (e): e is Extract<MetricsEvent, { type: 'sanity-failed' }> =>
        e.type === 'sanity-failed'
    );
    const failedEdits = sanityFailed.length;

    let avgRetries = 0;
    if (sanityFailed.length > 0) {
      const totalRetries = sanityFailed.reduce(
        (sum, e) => sum + (e.data.retryCount ?? 0),
        0
      );
      avgRetries = Math.round((totalRetries / sanityFailed.length) * 10) / 10;
    }

    let mostRecent: SidebarStats['mostRecent'] = null;
    if (events.length > 0) {
      const last = events[events.length - 1];
      const file = (last.data as { file?: string }).file ?? 'unknown';
      mostRecent = {
        file,
        eventType: last.type,
        timestamp: last.timestamp,
      };
    }

    return { blockedEdits, passedEdits, failedEdits, avgRetries, mostRecent };
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
