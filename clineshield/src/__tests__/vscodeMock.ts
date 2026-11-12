/**
 * Minimal fake of the `vscode` module for provider unit tests. Use with
 * jest.mock('vscode', () => require('<rel>/__tests__/vscodeMock'), { virtual: true }).
 * Watchers and listeners are recorded so tests can fire events and count
 * live (undisposed) listeners. Not a test file (testMatch is *.test.ts).
 */

type Handler = (...args: unknown[]) => unknown;

export interface FakeWatcher {
  pattern: string;
  handlers: { create: Handler[]; change: Handler[]; delete: Handler[] };
  fire(kind: 'create' | 'change' | 'delete'): void;
  disposed: boolean;
}

export const watchers: FakeWatcher[] = [];

export function reset(): void {
  watchers.length = 0;
  commands.executeCommand.mockReset();
  commands.executeCommand.mockResolvedValue(undefined);
}

const disposable = (fn: () => void = () => undefined) => ({ dispose: fn });

export class Disposable {
  constructor(private readonly fn: () => void) {}
  dispose(): void { this.fn(); }
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  readonly event = (l: (e: T) => void) => {
    this.listeners.push(l);
    return disposable(() => { this.listeners = this.listeners.filter(x => x !== l); });
  };
  fire(e: T): void { for (const l of [...this.listeners]) l(e); }
  dispose(): void { this.listeners = []; }
  get count(): number { return this.listeners.length; }
}

export const Uri = {
  file: (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` }),
  parse: (s: string) => ({ fsPath: s, toString: () => s }),
};

export class RelativePattern {
  constructor(public base: unknown, public pattern: string) {}
}

export class ThemeIcon { constructor(public id: string, public color?: unknown) {} }
export class ThemeColor { constructor(public id: string) {} }
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export class TreeItem {
  [k: string]: unknown;
  constructor(public label: unknown, public collapsibleState?: TreeItemCollapsibleState) {}
}

export const workspace = {
  createFileSystemWatcher: (p: RelativePattern): FakeWatcher & Record<string, unknown> => {
    const handlers: FakeWatcher['handlers'] = { create: [], change: [], delete: [] };
    const on = (kind: keyof typeof handlers) => (h: Handler) => { handlers[kind].push(h); return disposable(); };
    const w = {
      pattern: p.pattern, handlers, disposed: false,
      fire(kind: keyof typeof handlers) { for (const h of handlers[kind]) h(); },
      onDidCreate: on('create'), onDidChange: on('change'), onDidDelete: on('delete'),
      dispose() { w.disposed = true; },
    };
    watchers.push(w);
    return w;
  },
};

export const window = {
  onDidChangeWindowState: () => disposable(),
  showErrorMessage: jest.fn(async () => undefined),
  showInformationMessage: jest.fn(async () => undefined),
  showTextDocument: jest.fn(async () => undefined),
};

export const commands = { executeCommand: jest.fn(async (..._args: unknown[]): Promise<unknown> => undefined) };

export const env = {
  clipboard: { writeText: jest.fn(async () => undefined) },
  openExternal: jest.fn(async () => true),
};

/** A fake WebviewView whose message and dispose listeners can be driven and counted. */
export function fakeView() {
  const messages = new EventEmitter<unknown>();
  const visibility = new EventEmitter<void>();
  const disposeEvents = new EventEmitter<void>();
  const posted: unknown[] = [];
  return {
    visible: true,
    webview: {
      options: {}, html: '', cspSource: 'csp',
      onDidReceiveMessage: messages.event,
      postMessage: async (m: unknown) => { posted.push(m); return true; },
    },
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposeEvents.event,
    send: (m: unknown) => messages.fire(m),
    dispose: () => disposeEvents.fire(),
    messageListeners: () => messages.count,
    visibilityListeners: () => visibility.count,
    posted,
  };
}
