import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import defaultPlugin, { createClineShieldPlugin, guardHook, plugin as namedPlugin } from '../index';
import type { PluginSetupContext } from '../types';
import { validateEvent } from './validateEvent';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readMetrics(root: string): Promise<unknown[]> {
  return JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8'));
}

// Minimal fakes for the runtime hook contexts (sdk/packages/shared/src/agent.ts).
const snapshot = { agentId: 'agent-1', conversationId: 'conv-1', runId: 'run-1' };
const toolCall = { toolCallId: 'call-1', toolName: 'editor', input: { path: 'a.ts' } };

describe('ClineShield plugin', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-plugin-'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('package shape', () => {
    it('exports the same AgentPlugin as default and named export', () => {
      expect(defaultPlugin).toBe(namedPlugin);
      expect(defaultPlugin.name).toBe('clineshield');
    });

    it('declares only the hooks capability', () => {
      expect(defaultPlugin.manifest.capabilities).toEqual(['hooks']);
    });

    it('provides beforeTool and afterTool hooks', () => {
      expect(typeof defaultPlugin.hooks?.beforeTool).toBe('function');
      expect(typeof defaultPlugin.hooks?.afterTool).toBe('function');
    });

    it('setup() is synchronous (returns no promise)', async () => {
      const p = createClineShieldPlugin();
      const ret = p.setup?.({}, { workspaceInfo: { rootPath: root } });
      expect(ret).toBeUndefined();
      await p.flush();
    });
  });

  describe('session identity', () => {
    it('uses the session id from the plugin setup context', async () => {
      const p = createClineShieldPlugin();
      p.setup?.({}, { session: { sessionId: 'core-session-42' }, workspaceInfo: { rootPath: root } });
      await p.flush();

      expect(p.sessionId).toBe('core-session-42');
      const events = await readMetrics(root);
      expect(events).toHaveLength(1);
      expect((events[0] as { sessionId: string }).sessionId).toBe('core-session-42');
    });

    it('falls back to a UUID when the host provides no session id', async () => {
      const p = createClineShieldPlugin();
      p.setup?.({}, { workspaceInfo: { rootPath: root } });
      await p.flush();

      expect(p.sessionId).toMatch(UUID_RE);
      const events = await readMetrics(root);
      expect((events[0] as { sessionId: string }).sessionId).toBe(p.sessionId);
    });

    it('falls back to a UUID when the session id is empty', async () => {
      const p = createClineShieldPlugin();
      p.setup?.({}, { session: { sessionId: '' }, workspaceInfo: { rootPath: root } });
      await p.flush();
      expect(p.sessionId).toMatch(UUID_RE);
    });

    it('writes the same session-start marker as the VS Code extension', async () => {
      const p = createClineShieldPlugin();
      p.setup?.({}, { session: { sessionId: 's1' }, workspaceInfo: { rootPath: root } });
      await p.flush();

      const [event] = await readMetrics(root);
      expect(event).toEqual({
        timestamp: expect.any(String),
        sessionId: 's1',
        type: 'edit-allowed',
        data: { file: 'session-start', structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0 },
      });
    });
  });

  describe('metrics writer', () => {
    it('every event the plugin writes validates against metrics.ts', async () => {
      const p = createClineShieldPlugin();
      p.setup?.({}, { session: { sessionId: 's1' }, workspaceInfo: { rootPath: root } });
      await p.flush();

      const events = await readMetrics(root);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(validateEvent(event)).toEqual([]);
      }
    });

    it('prefers workspaceInfo.rootPath over cwd', async () => {
      const other = await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-cwd-'));
      try {
        const p = createClineShieldPlugin();
        p.setup?.({}, { workspaceInfo: { rootPath: root }, cwd: other });
        await p.flush();
        expect(p.workspaceRoot).toBe(root);
        await expect(fs.access(path.join(other, '.cline-shield'))).rejects.toThrow();
      } finally {
        await fs.rm(other, { recursive: true, force: true });
      }
    });

    it('uses ctx.cwd when workspaceInfo is missing', async () => {
      const p = createClineShieldPlugin();
      p.setup?.({}, { cwd: root });
      await p.flush();
      expect(p.workspaceRoot).toBe(root);
      expect(await readMetrics(root)).toHaveLength(1);
    });

    it('falls back to process.cwd() when the host provides no workspace', () => {
      const p = createClineShieldPlugin();
      const spy = jest.spyOn(process, 'cwd').mockReturnValue(root);
      p.setup?.({}, undefined as unknown as PluginSetupContext);
      spy.mockRestore();
      expect(p.workspaceRoot).toBe(root);
      expect(p.sessionId).toMatch(UUID_RE);
      return p.flush();
    });
  });

  describe('hooks', () => {
    it('beforeTool and afterTool pass through calls the policy cannot parse', async () => {
      const p = createClineShieldPlugin();
      p.setup?.({}, { workspaceInfo: { rootPath: root } });
      await p.flush();

      const before = await p.hooks?.beforeTool?.({ snapshot, tool: { name: 'editor' }, toolCall, input: toolCall.input });
      const after = await p.hooks?.afterTool?.({
        snapshot, tool: { name: 'editor' }, toolCall, input: toolCall.input,
        result: { output: 'ok' }, startedAt: new Date(), endedAt: new Date(), durationMs: 1,
      });
      expect(before).toBeUndefined();
      expect(after).toBeUndefined();
    });

    it('hooks do not throw when called before setup()', async () => {
      const p = createClineShieldPlugin();
      await expect(
        Promise.resolve(p.hooks?.beforeTool?.({ snapshot, tool: { name: 'editor' }, toolCall, input: {} })),
      ).resolves.toBeUndefined();
    });

    it('setup() never throws, even if the host context is hostile', async () => {
      const hostile = {
        get session(): never { throw new Error('boom'); },
        workspaceInfo: { rootPath: root },
      } as unknown as PluginSetupContext;
      const p = createClineShieldPlugin();
      expect(() => p.setup?.({}, hostile)).not.toThrow();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ClineShield]'), expect.anything());
      await p.flush();
    });
  });

  describe('guardHook', () => {
    it('passes through the hook result', async () => {
      const guarded = guardHook('beforeTool', async () => ({ skip: true }));
      await expect(guarded({} as never)).resolves.toEqual({ skip: true });
    });

    it('catches a synchronous throw, logs to stderr and returns undefined', async () => {
      const guarded = guardHook('beforeTool', () => { throw new Error('sync boom'); });
      await expect(guarded({} as never)).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith('[ClineShield] beforeTool hook failed:', expect.any(Error));
    });

    it('catches an async rejection, logs to stderr and returns undefined', async () => {
      const guarded = guardHook('afterTool', async () => { throw new Error('async boom'); });
      await expect(guarded({} as never)).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith('[ClineShield] afterTool hook failed:', expect.any(Error));
    });
  });
});
