/**
 * Plugin-level tests for Risk scoring (SPEC.md Part 2): afterTool scores every
 * successful apply_patch / editor edit to a TS/JS file with computeRiskScore()
 * and writes one risk-assessed event per file.
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
const twoFunctions = (file: string) =>
  [`*** Update File: ${file}`, '@@', ' keep', ' keep2', '-function a() {}', '-function b() {}'].join('\n');
const fourFunctions = (file: string) =>
  [`*** Update File: ${file}`, '@@', '-function a() {}', '-function b() {}', '-function c() {}', '-function d() {}'].join('\n');
/** 12 changed lines (2 deleted functions) + 8 context = 60 % of a 20-line patch → approve tier. */
const mediumRewrite = (file: string) =>
  [
    `*** Update File: ${file}`,
    '@@',
    ...Array.from({ length: 8 }, (_, i) => ` ctx${i}`),
    '-function a() {}',
    '-function b() {}',
    ...Array.from({ length: 4 }, (_, i) => `-old${i}`),
    ...Array.from({ length: 6 }, (_, i) => `+new${i}`),
  ].join('\n');

describe('Risk scoring (plugin afterTool)', () => {
  let root: string;
  let plugin: ClineShieldPlugin;
  let callSeq = 0;

  async function riskEvents(): Promise<Event[]> {
    await plugin.flush();
    const all = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')) as Event[];
    for (const e of all) expect(validateEvent(e)).toEqual([]);
    return all.filter(e => e.type === 'risk-assessed');
  }

  function call(toolName: string, input: unknown) {
    const toolCall = { toolCallId: `risk-call-${++callSeq}`, toolName, input };
    const ctx = { snapshot, tool: { name: toolName }, toolCall, input };
    return {
      before: () => plugin.hooks!.beforeTool!(ctx),
      after: (result: AgentToolResult) =>
        plugin.hooks!.afterTool!({ ...ctx, result, startedAt: new Date(), endedAt: new Date(), durationMs: 3 }),
    };
  }

  async function run(toolName: string, input: unknown, result: AgentToolResult = { output: 'ok' }) {
    const c = call(toolName, input);
    await c.before();
    return c.after(result);
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-risk-'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    plugin = createClineShieldPlugin();
    plugin.setup?.({}, { session: { sessionId: 'sess-1' }, workspaceInfo: { rootPath: root } });
  });

  afterEach(async () => {
    await plugin.flush();
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes one low risk-assessed event for a small successful edit, exact shape', async () => {
    await expect(run('apply_patch', patch(small('src/a.ts')))).resolves.toBeUndefined();
    expect(await riskEvents()).toEqual([
      {
        timestamp: expect.any(String),
        sessionId: 'sess-1',
        type: 'risk-assessed',
        data: { file: 'src/a.ts', rulesScore: 0, level: 'low', reasons: [] },
      },
    ]);
  });

  it('adds the protected path rule for the 1.x default protected paths', async () => {
    await run('apply_patch', patch(small('src/auth/login.ts')));
    const [e] = await riskEvents();
    expect(e.data).toEqual({
      file: 'src/auth/login.ts',
      rulesScore: 30,
      level: 'low',
      reasons: [{ rule: 'protected_path', points: 30, description: 'File is in a protected path (src/auth/login.ts)' }],
    });
  });

  it('applies the test-file discount', async () => {
    await run('apply_patch', patch(small('src/auth/login.test.ts')));
    const [e] = await riskEvents();
    expect(e.data.rulesScore).toBe(20);
    expect((e.data.reasons as Array<{ rule: string }>).map(r => r.rule)).toEqual(['protected_path', 'test_file']);
  });

  it('scores deleted functions', async () => {
    // 2 deleted functions → approve tier; the user approves.
    await run('apply_patch', patch(twoFunctions('src/a.ts')));
    const [e] = await riskEvents();
    expect(e.data).toMatchObject({ rulesScore: 20, level: 'low' });
    expect((e.data.reasons as Array<{ rule: string }>).map(r => r.rule)).toEqual(['deleted_functions_low']);
  });

  it('reaches high for an approved medium rewrite of a protected file', async () => {
    await run('apply_patch', patch(mediumRewrite('config/app.ts')));
    const [e] = await riskEvents();
    expect(e.data).toMatchObject({ file: 'config/app.ts', rulesScore: 75, level: 'high' });
    expect((e.data.reasons as Array<{ rule: string }>).map(r => r.rule)).toEqual([
      'protected_path',
      'structural_change_medium',
      'deleted_functions_low',
    ]);
  });

  it('scores editor edits with a workspace-relative path', async () => {
    await run('editor', { path: path.join(root, 'src', 'middleware', 'cors.js'), old_text: 'a', new_text: 'b' });
    const [e] = await riskEvents();
    expect(e.data).toMatchObject({ file: 'src/middleware/cors.js', rulesScore: 30 });
  });

  it('writes one event per TS/JS file and skips non-TS/JS files', async () => {
    await run('apply_patch', patch(small('src/a.ts'), small('README.md'), small('src/auth/b.tsx')));
    expect((await riskEvents()).map(e => e.data.file)).toEqual(['src/a.ts', 'src/auth/b.tsx']);
  });

  it('ignores non-TS/JS files and non-edit tools', async () => {
    await run('apply_patch', patch(small('src/auth/notes.md')));
    await run('read_files', { paths: ['src/auth/a.ts'] });
    expect(await riskEvents()).toEqual([]);
  });

  it('writes no event when the user denies approval', async () => {
    await run('apply_patch', patch(twoFunctions('src/a.ts')), {
      output: { error: `Rejected by user -- ${TOOL_REJECTION_SUFFIX}` },
      isError: true,
    });
    expect(await riskEvents()).toEqual([]);
  });

  it('writes no event for a blocked (skipped) edit', async () => {
    const c = call('apply_patch', patch(fourFunctions('src/a.ts')));
    const before = await c.before();
    await c.after({ output: { error: (before as { reason: string }).reason }, isError: true });
    expect(await riskEvents()).toEqual([]);
  });

  it('writes no event when the edit itself failed', async () => {
    await run('apply_patch', patch(small('src/a.ts')), {
      output: { error: 'Could not find matching context' },
      isError: true,
    });
    expect(await riskEvents()).toEqual([]);
  });

  it('measures from the input when beforeTool did not run for the call', async () => {
    const c = call('apply_patch', patch(small('src/config/db.ts')));
    await c.after({ output: 'ok' });
    const [e] = await riskEvents();
    expect(e.data).toMatchObject({ file: 'src/config/db.ts', rulesScore: 30 });
  });

  it('scores a new file on path and size only, never as a structural rewrite', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `+const x${i} = () => ${i};`);
    await run('apply_patch', patch(['*** Add File: src/new.ts', ...lines].join('\n')));
    const [e] = await riskEvents();
    expect(e.data).toMatchObject({ file: 'src/new.ts', rulesScore: 0, level: 'low', reasons: [] });
  });

  it('afterTool stays well under 200 ms on a large patch', async () => {
    const body = Array.from({ length: 5000 }, (_, i) => (i % 2 ? `-old${i}` : ` ctx${i}`));
    const c = call('apply_patch', patch(['*** Update File: src/big.ts', '@@', ...body].join('\n')));
    const t0 = Date.now();
    await c.after({ output: 'ok' });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('a scoring error is caught by guardHook (logged, no throw)', async () => {
    const c = call('apply_patch', {
      get input(): string {
        throw new Error('boom');
      },
    });
    await expect(c.after({ output: 'ok' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[ClineShield] afterTool hook failed:', expect.any(Error));
  });
});
