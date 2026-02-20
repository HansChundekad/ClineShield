/**
 * ChangeMapProvider.ts
 *
 * Read-only TreeDataProvider that shows a per-file risk map derived from
 * metrics.json. Never writes to metrics.json or any other file.
 *
 * Isolation guarantee: all errors are caught internally. If this provider
 * fails for any reason, getChildren() returns [] and other features are
 * unaffected.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { readEventsBySession } from '../metrics/reader';

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

interface FileStats {
  editCount: number;
  worstLevel: RiskLevel | null;
}

const LEVEL_ORDER: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

function worstOf(a: RiskLevel | null, b: RiskLevel | null): RiskLevel | null {
  if (!a) { return b; }
  if (!b) { return a; }
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

function iconForLevel(level: RiskLevel | null): vscode.ThemeIcon {
  if (level === 'high') {
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.red'));
  }
  if (level === 'medium') {
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
  }
  if (level === 'low') {
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
  }
  return new vscode.ThemeIcon('circle-outline');
}

// ── Tree nodes ────────────────────────────────────────────────────────────────

export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly stats: FileStats,
    workspaceRoot: string,
  ) {
    const label = path.basename(filePath);
    super(label, vscode.TreeItemCollapsibleState.None);

    const levelLabel = stats.worstLevel ? stats.worstLevel.toUpperCase() : 'UNSCORED';
    this.description = `${stats.editCount} edit${stats.editCount !== 1 ? 's' : ''} · ${levelLabel}`;
    this.tooltip = `${filePath}\nEdits: ${stats.editCount}\nWorst risk: ${levelLabel}`;
    this.iconPath = iconForLevel(stats.worstLevel);
    this.contextValue = 'changeMapFile';
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [vscode.Uri.file(path.join(workspaceRoot, filePath))],
    };
  }
}

export class FolderItem extends vscode.TreeItem {
  public readonly children: FileItem[];

  constructor(
    folderPath: string,
    children: FileItem[],
  ) {
    super(folderPath, vscode.TreeItemCollapsibleState.Expanded);

    this.children = children;

    // Derive folder-level worst risk from children
    const folderLevel = children.reduce<RiskLevel | null>(
      (acc, child) => worstOf(acc, child.stats.worstLevel),
      null
    );
    const totalEdits = children.reduce((sum, c) => sum + c.stats.editCount, 0);

    const levelLabel = folderLevel ? folderLevel.toUpperCase() : 'UNSCORED';
    this.description = `${totalEdits} edit${totalEdits !== 1 ? 's' : ''} · ${levelLabel}`;
    this.tooltip = `${folderPath}/\nFiles: ${children.length}\nWorst risk: ${levelLabel}`;
    this.iconPath = new vscode.ThemeIcon('folder', folderLevel
      ? new vscode.ThemeColor(
          folderLevel === 'high' ? 'charts.red'
          : folderLevel === 'medium' ? 'charts.yellow'
          : 'charts.green'
        )
      : undefined
    );
    this.contextValue = 'changeMapFolder';
  }
}

type ChangeMapItem = FileItem | FolderItem;

// ── Provider ──────────────────────────────────────────────────────────────────

export class ChangeMapProvider implements vscode.TreeDataProvider<ChangeMapItem>, vscode.Disposable {
  public static readonly viewType = 'clineshield.changeMapView';

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly watcher: vscode.FileSystemWatcher;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspaceRoot: string,
    private readonly sessionId: string,
  ) {
    // Own watcher — isolated from extension.ts watcher and MetricsSidebarProvider watcher.
    // Atomic writes (temp+rename) fire onDidCreate on macOS, not onDidChange.
    this.watcher = vscode.workspace.createFileSystemWatcher('**/.cline-shield/metrics.json');
    this.watcher.onDidChange(() => this._onDidChangeTreeData.fire());
    this.watcher.onDidCreate(() => this._onDidChangeTreeData.fire());
    this.disposables.push(this.watcher);
  }

  getTreeItem(element: ChangeMapItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ChangeMapItem): Promise<ChangeMapItem[]> {
    try {
      if (element instanceof FolderItem) {
        return element.children;
      }
      // Root level
      return await this.buildRootItems();
    } catch {
      // Never propagate errors — other features must continue working
      return [];
    }
  }

  // ── Aggregation ─────────────────────────────────────────────────────────────

  private async aggregateStats(): Promise<Map<string, FileStats>> {
    // readEventsBySession returns [] on any error — safe to call without extra try/catch
    const events = await readEventsBySession(this.sessionId, this.workspaceRoot);

    const statsMap = new Map<string, FileStats>();

    const getOrCreate = (file: string): FileStats => {
      if (!statsMap.has(file)) {
        statsMap.set(file, { editCount: 0, worstLevel: null });
      }
      return statsMap.get(file)!;
    };

    for (const event of events) {
      const data = event.data as { file?: string; level?: string };
      const file = data.file;
      if (!file || file === 'session-start') { continue; }

      if (event.type === 'edit-allowed' || event.type === 'edit-blocked') {
        getOrCreate(file).editCount += 1;
      }

      if (event.type === 'risk-assessed') {
        const level = data.level as RiskLevel | undefined;
        if (level === 'low' || level === 'medium' || level === 'high') {
          const stats = getOrCreate(file);
          stats.worstLevel = worstOf(stats.worstLevel, level);
        }
      }
    }

    return statsMap;
  }

  // ── Tree building ────────────────────────────────────────────────────────────

  private async buildRootItems(): Promise<ChangeMapItem[]> {
    const statsMap = await this.aggregateStats();

    if (statsMap.size === 0) {
      const empty = new vscode.TreeItem('No edits recorded this session');
      empty.iconPath = new vscode.ThemeIcon('info');
      return [empty as ChangeMapItem];
    }

    // Group files by immediate parent directory.
    // Files with dirname '.' are placed at root without a folder wrapper.
    const folderMap = new Map<string, Array<{ filePath: string; stats: FileStats }>>();
    const rootFiles: Array<{ filePath: string; stats: FileStats }> = [];

    for (const [filePath, stats] of statsMap) {
      const dir = path.dirname(filePath);
      if (dir === '.') {
        rootFiles.push({ filePath, stats });
      } else {
        if (!folderMap.has(dir)) { folderMap.set(dir, []); }
        folderMap.get(dir)!.push({ filePath, stats });
      }
    }

    const items: ChangeMapItem[] = [];

    // Folders (sorted alphabetically)
    for (const [folderPath, files] of [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const children = files
        .sort((a, b) => a.filePath.localeCompare(b.filePath))
        .map(({ filePath, stats }) => new FileItem(filePath, stats, this.workspaceRoot));
      items.push(new FolderItem(folderPath, children));
    }

    // Root-level files (sorted alphabetically)
    for (const { filePath, stats } of rootFiles.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
      items.push(new FileItem(filePath, stats, this.workspaceRoot));
    }

    return items;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
    this._onDidChangeTreeData.dispose();
  }
}
