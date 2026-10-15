/**
 * Plugin-level tests for the Edit Size Policy: drive beforeTool / afterTool
 * with fake tool calls shaped like the SDK runtime's (agent-runtime.ts
 * L2432 beforeTool dispatch, L2493 requestToolApproval, L2592 afterTool)
 * and assert hook results + metrics.json events.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createClineShieldPlugin, TOOL_REJECTION_SUFFIX } from '../index';
import type { AgentToolResult, ClineShieldPlugin } from '../index';
import { validateEvent } from './validateEvent';

type Event = { type: string; sessionId: string; data: Record<string, unknown> };

const snapshot = { agentId: 'agent-1', conversationId: 'conv-1', runId: 'run-1' };

function patch(...sections: string[]): { input: string } {
  return { input: ['*** Begin Patch', ...sections, '*** End Patch'].join('\n') };
}
const small = (file: string) => [`*** Update File: ${file}`, '@@', ' keep', '-old', '+new'].join('\n');
const fourFunctions = (file: string) =>
  [`*** Update File: ${file}`, '@@', '-function a() {}', '-function b() {}', '-function c() {}', '-function d() {}'].join('\n');
const twoFunctions = (file: string) => [`*** Update File: ${file}`, '@@', '-function a() {}', '-function b() {}'].join('\n');

describe('Edit Size Policy (plugin hooks)', () => {
  let root: string;
  let plugin: ClineShieldPlugin;
  let callSeq = 0;

  async function events(): Promise<Event[]> {
    await plugin.flush();
    const all = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')) as Event[];
    for (const e of all) expect(validateEvent(e)).toEqual([]);
    // risk-assessed events are covered by riskScoring.test.ts.
    return all.filter(e => e.data.file !== 'session-start' && e.type !== 'risk-assessed');
  }

  function call(toolName: string, input: unknown) {
    const toolCall = { toolCallId: `call-${++callSeq}`, toolName, input };
    const ctx = { snapshot, tool: { name: toolName }, toolCall, input };
    return {
      before: () => plugin.hooks!.beforeTool!(ctx),
      after: (result: AgentToolResult) =>
        plugin.hooks!.afterTool!({ ...ctx, result, startedAt: new Date(), endedAt: new Date(), durationMs: 3 }),
    };
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-policy-'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    plugin = createClineShieldPlugin();
    plugin.setup?.({}, { session: { sessionId: 'sess-1' }, workspaceInfo: { rootPath: root } });
  });

  afterEach(async () => {
    await plugin.flush();
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('allow', () => {
    it('returns undefined and writes edit-allowed', async () => {
      const c = call('apply_patch', patch(small('src/a.ts')));
      await expect(c.before()).resolves.toBeUndefined();
      expect(await events()).toEqual([
        {
          timestamp: expect.any(String),
          sessionId: 'sess-1',
          type: 'edit-allowed',
          data: { file: 'src/a.ts', structuralChangePercent: 66, functionsDeleted: 0, exportsDeleted: 0 },
        },
      ]);
    });

    it('writes nothing more in afterTool', async () => {
      const c = call('apply_patch', patch(small('src/a.ts')));
      await c.before();
      await expect(c.after({ output: 'ok' })).resolves.toBeUndefined();
      expect(await events()).toHaveLength(1);
    });

    it('records editor edits with a workspace-relative path', async () => {
      const c = call('editor', { path: path.join(root, 'src', 'b.tsx'), old_text: 'a', new_text: 'b' });
      await expect(c.before()).resolves.toBeUndefined();
      const [e] = await events();
      expect(e.type).toBe('edit-allowed');
      expect(e.data.file).toBe('src/b.tsx');
    });

    it('keeps paths outside the workspace as written', async () => {
      const c = call('editor', { path: '/elsewhere/x.ts', old_text: 'a', new_text: 'b' });
      await c.before();
      expect((await events())[0].data.file).toBe('/elsewhere/x.ts');
    });
  });

  describe('block', () => {
    it('skips the call with an actionable reason, never stops the run, writes edit-blocked', async () => {
      const c = call('apply_patch', patch(fourFunctions('src/a.ts')));
      const result = await c.before();
      expect(result).toEqual({ skip: true, reason: expect.stringMatching(/smaller, targeted edits/) });
      expect(result).not.toHaveProperty('stop');
      expect(result!.reason).toContain('src/a.ts: 4 functions deleted (limit 3)');

      const evs = await events();
      expect(evs).toEqual([
        {
          timestamp: expect.any(String),
          sessionId: 'sess-1',
          type: 'edit-blocked',
          data: { file: 'src/a.ts', reason: result!.reason, structuralChangePercent: 100, functionsDeleted: 4, exportsDeleted: 0 },
        },
      ]);
    });

    it('afterTool on the skipped call (runtime still runs it) writes nothing more', async () => {
      const c = call('apply_patch', patch(fourFunctions('src/a.ts')));
      const { reason } = (await c.before())!;
      await expect(c.after({ output: { error: reason }, isError: true })).resolves.toBeUndefined();
      expect(await events()).toHaveLength(1);
    });
  });

  describe('approve', () => {
    it('asks for approval with the reason in appendContext and writes no event yet', async () => {
      const c = call('apply_patch', patch(twoFunctions('src/a.ts')));
      const result = await c.before();
      expect(result).toEqual({
        policy: { autoApprove: false },
        appendContext: expect.stringContaining('src/a.ts: 2 functions deleted (approval needed from 2)'),
      });
      expect(await events()).toEqual([]);
    });

    it('writes edit-approval approved=true when the tool ran', async () => {
      const c = call('apply_patch', patch(twoFunctions('src/a.ts')));
      const { appendContext } = (await c.before())!;
      await expect(c.after({ output: 'Done!' })).resolves.toBeUndefined();
      expect(await events()).toEqual([
        {
          timestamp: expect.any(String),
          sessionId: 'sess-1',
          type: 'edit-approval',
          data: {
            file: 'src/a.ts',
            structuralChangePercent: 100,
            functionsDeleted: 2,
            exportsDeleted: 0,
            reason: appendContext,
            approved: true,
          },
        },
      ]);
    });

    it('approved=true even if the approved tool then failed on its own', async () => {
      const c = call('apply_patch', patch(twoFunctions('src/a.ts')));
      await c.before();
      await c.after({ output: { error: 'Could not find matching context' }, isError: true });
      expect((await events())[0].data.approved).toBe(true);
    });

    it('writes approved=false when the user rejects', async () => {
      const c = call('apply_patch', patch(twoFunctions('src/a.ts')));
      await c.before();
      await c.after({ output: { error: `Rejected by user -- ${TOOL_REJECTION_SUFFIX}` }, isError: true });
      expect((await events())[0].data.approved).toBe(false);
    });

    it('writes approved=false in headless runs (no approval callback → denied)', async () => {
      const c = call('apply_patch', patch(twoFunctions('src/a.ts')));
      await c.before();
      const reason = 'Tool "apply_patch" requires approval but no approval callback is configured';
      await c.after({ output: { error: `${reason} -- ${TOOL_REJECTION_SUFFIX}` }, isError: true });
      expect((await events())[0].data.approved).toBe(false);
    });

    it('records the outcome once per call', async () => {
      const c = call('apply_patch', patch(twoFunctions('src/a.ts')));
      await c.before();
      await c.after({ output: 'ok' });
      await c.after({ output: 'ok' });
      expect(await events()).toHaveLength(1);
    });
  });

  describe('multi-file patches', () => {
    it('worst tier wins; one event per evaluated TS/JS file', async () => {
      const c = call('apply_patch', patch(small('src/ok.ts'), small('README.md'), fourFunctions('src/bad.js')));
      const result = await c.before();
      expect(result?.skip).toBe(true);
      const evs = await events();
      expect(evs.map(e => [e.type, e.data.file])).toEqual([
        ['edit-blocked', 'src/ok.ts'],
        ['edit-blocked', 'src/bad.js'],
      ]);
      expect(evs[0].data.reason).toBe(result!.reason);
    });

    it('approve + allow: both files get edit-approval after the decision', async () => {
      const c = call('apply_patch', patch(small('a.ts'), twoFunctions('b.ts')));
      expect((await c.before())?.policy).toEqual({ autoApprove: false });
      await c.after({ output: { error: `no -- ${TOOL_REJECTION_SUFFIX}` }, isError: true });
      const evs = await events();
      expect(evs.map(e => [e.type, e.data.file, e.data.approved])).toEqual([
        ['edit-approval', 'a.ts', false],
        ['edit-approval', 'b.ts', false],
      ]);
    });
  });

  describe('pass-through', () => {
    it.each([
      ['apply_patch', patch(fourFunctions('README.md'))],
      ['editor', { path: '/w/notes.md', old_text: 'a', new_text: 'b' }],
      ['read_files', { files: [{ path: 'src/a.ts' }] }],
      ['run_commands', { commands: ['ls'] }],
      ['editor', { path: 'a.ts' }],
    ])('%s %j → untouched, no event', async (tool, input) => {
      const c = call(tool, input);
      await expect(c.before()).resolves.toBeUndefined();
      await expect(c.after({ output: 'ok' })).resolves.toBeUndefined();
      expect(await events()).toEqual([]);
    });
  });

  it('beforeTool stays well under 200 ms on a large patch', async () => {
    const body = ['*** Update File: big.ts', '@@'];
    for (let i = 0; i < 5000; i++) body.push(` keep ${i}`, `-const v${i} = ${i};`, `+const v${i} = ${i + 1};`);
    const c = call('apply_patch', patch(body.join('\n')));
    const start = process.hrtime.bigint();
    await c.before();
    expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(200);
  });

  it('a policy error is caught by guardHook (fails open, logged)', async () => {
    const hostile = { get input(): never { throw new Error('boom'); } };
    const c = call('apply_patch', hostile);
    await expect(c.before()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[ClineShield] beforeTool hook failed:', expect.any(Error));
  });
});
