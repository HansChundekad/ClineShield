jest.mock('vscode', () => require('../../__tests__/vscodeMock'), { virtual: true });

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MetricsSidebarProvider } from '../MetricsSidebarProvider';
import { ConfigStore } from '../../plugin/config/store';

const mock = vscode as unknown as typeof import('../../__tests__/vscodeMock');
const flush = () => new Promise(res => setTimeout(res, 120)); // > 50 ms refresh debounce

describe('MetricsSidebarProvider', () => {
  let root: string;
  let provider: MetricsSidebarProvider;
  let waitingCalls: number;

  beforeEach(async () => {
    mock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sidebar-'));
    waitingCalls = 0;
    provider = new MetricsSidebarProvider({
      extensionUri: mock.Uri.file(root) as never,
      metricsRoot: root, workspaceRoot: root, sessionId: 'ext', activationTime: Date.now(),
      homeDir: root,
      secrets: { get: async () => undefined } as never,
      configStore: new ConfigStore({ homeDir: root }),
      onWaitingCount: () => { waitingCalls++; },
    });
    await flush();
  });
  afterEach(async () => {
    provider.dispose();
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  const metricsWatchers = () => mock.watchers.filter(w => w.pattern.startsWith('.cline-shield/'));

  it('watches metrics.json and answers.json for create, change and delete', () => {
    expect(metricsWatchers().map(w => w.pattern).sort()).toEqual(['.cline-shield/answers.json', '.cline-shield/metrics.json']);
    for (const w of metricsWatchers()) {
      expect(w.handlers.create).toHaveLength(1);
      expect(w.handlers.change).toHaveLength(1);
      expect(w.handlers.delete).toHaveLength(1);
    }
  });

  it('deleting metrics.json triggers a refresh', async () => {
    const before = waitingCalls;
    metricsWatchers().find(w => w.pattern.endsWith('metrics.json'))!.fire('delete');
    await flush();
    expect(waitingCalls).toBe(before + 1);
  });

  it('a failing message handler is caught and logged, not left unhandled', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      mock.commands.executeCommand.mockRejectedValue(new Error('boom'));
      const view = mock.fakeView();
      await provider.resolveWebviewView(view as never);
      view.send({ type: 'setKey' });
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ClineShield]'), 'boom');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('resolving the view twice keeps one listener per view', async () => {
    const first = mock.fakeView();
    const second = mock.fakeView();
    await provider.resolveWebviewView(first as never);
    await provider.resolveWebviewView(second as never);
    expect(first.messageListeners()).toBe(0);
    expect(first.visibilityListeners()).toBe(0);
    expect(second.messageListeners()).toBe(1);
    expect(second.visibilityListeners()).toBe(1);
  });

  it('disposing the view releases its listeners', async () => {
    const view = mock.fakeView();
    await provider.resolveWebviewView(view as never);
    view.dispose();
    expect(view.messageListeners()).toBe(0);
    expect(view.visibilityListeners()).toBe(0);
  });
});
