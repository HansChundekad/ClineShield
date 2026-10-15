/**
 * Plugin-level tests for the Risk rubric: beforeTool decisions, events and
 * config handling against a real temp workspace.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createClineShieldPlugin, TOOL_REJECTION_SUFFIX } from '../index';
import type { AgentToolResult, ClineShieldPlugin } from '../index';
import { validateEvent } from './validateEvent';
import * as gather from '../rubric/gather';

type Event = { type: string; data: Record<string, unknown> };
const snapshot = { agentId: 'a', conversationId: 'conv-1', runId: 'r' };
const patch = (...body: string[]) => ({ input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n') });
const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe('Risk rubric (plugin)', () => {
  let root: string;
  let home: string;
  let plugin: ClineShieldPlugin;
  let seq = 0;

  const call = (toolName: string, input: unknown) => {
    const toolCall = { toolCallId: `c${++seq}`, toolName, input };
    const ctx = { snapshot, tool: { name: toolName }, toolCall, input };
    return {
      before: () => plugin.hooks!.beforeTool!(ctx),
      after: (result: AgentToolResult = { output: 'ok' }) =>
        plugin.hooks!.afterTool!({ ...ctx, result, startedAt: new Date(), endedAt: new Date(), durationMs: 1 }),
    };
  };
  const events = async (type?: string): Promise<Event[]> => {
    await plugin.flush();
    const all = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')) as Event[];
    for (const e of all) expect(validateEvent(e)).toEqual([]);
    return type ? all.filter(e => e.type === type) : all;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-plugin-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
    await fs.mkdir(path.join(root, 'lib'));
    await fs.writeFile(path.join(root, 'lib', 'big.ts'), lines(2000).join('\n') + '\n');
    await fs.writeFile(path.join(root, 'lib', 'small.ts'), lines(40).join('\n') + '\n');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    plugin = createClineShieldPlugin({ homeDir: home, pluginDir: '/nonexistent' });
    plugin.setup?.({}, { session: { sessionId: 's1' }, workspaceInfo: { rootPath: root } });
  });
  afterEach(async () => {
    await plugin.flush();
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('small edit to a big file → allowed, edit-allowed + risk-assessed low', async () => {
    const c = call('apply_patch', patch('*** Update File: lib/big.ts', '@@', ' l0', '-l1', '+L1'));
    await expect(c.before()).resolves.toBeUndefined();
    await c.after();
    expect((await events('edit-allowed')).filter(e => e.data.file === 'lib/big.ts')).toHaveLength(1);
    expect((await events('risk-assessed'))[0].data).toMatchObject({ file: 'lib/big.ts', rulesScore: 0, level: 'low' });
  });

  it('full rewrite of an ordinary file → asked; approval recorded', async () => {
    const c = call('apply_patch', patch('*** Update File: lib/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+x'));
    const r = await c.before();
    expect(r).toMatchObject({ policy: { autoApprove: false } });
    expect((r as { appendContext: string }).appendContext).toMatch(/asked the user to approve/);
    await c.after({ output: { error: `denied. ${TOOL_REJECTION_SUFFIX}` }, isError: true });
    const [ev] = await events('edit-approval');
    expect(ev.data).toMatchObject({ file: 'lib/small.ts', approved: false, structuralChangePercent: 95 });
  });

  it('placeholder rewrite → blocked, edit-blocked, reason without points', async () => {
    const c = call('apply_patch', patch('*** Update File: lib/small.ts', '@@', ' l0', '-l1', '+// ... rest of code unchanged'));
    const r = (await c.before()) as { skip: boolean; reason: string };
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/placeholder/);
    expect(r.reason).not.toMatch(/points|cut-?off/);
    expect((await events('edit-blocked'))[0].data.file).toBe('lib/small.ts');
  });

  it('file delete is now evaluated (Decision 8)', async () => {
    const r = await call('apply_patch', patch('*** Delete File: lib/small.ts')).before();
    expect(r).toBeUndefined(); // 35 < 40 under balanced: allowed, but scored
    expect((await events('edit-allowed')).some(e => e.data.file === 'lib/small.ts')).toBe(true);
  });

  it('non-JS files are scored too', async () => {
    const r = await call('apply_patch', patch('*** Update File: .github/workflows/ci.yml', '@@', '-a', '+b')).before();
    expect(r).toBeUndefined(); // 35 → allow, but recorded
    await fs.writeFile(path.join(root, '.env'), 'A=1\n');
    expect(await call('apply_patch', patch('*** Update File: .env', '@@', '-A=1', '+A=2')).before()).toMatchObject({ policy: { autoApprove: false } });
  });

  it('third block on the same file adds the stop-and-ask note', async () => {
    const bad = () => call('apply_patch', patch('*** Update File: lib/small.ts', '@@', '-l1', '+// ... rest of code unchanged')).before();
    await bad(); await bad();
    expect(((await bad()) as { reason: string }).reason).toMatch(/Stop and ask the user how to proceed\.$/);
  });

  it('unparseable edit input → ask (on_error default); allow when the personal config says so', async () => {
    expect(await call('editor', { path: 'lib/a.ts' }).before()).toMatchObject({ policy: { autoApprove: false } });
    expect(await call('apply_patch', { input: 'garbage' }).before()).toMatchObject({ policy: { autoApprove: false } });
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'on_error: allow\n');
    expect(await call('editor', { path: 'lib/a.ts' }).before()).toBeUndefined();
  });

  it('a project .cline-shield.yml has no effect', async () => {
    await fs.writeFile(path.join(root, '.cline-shield.yml'),
      'mode: observe\npreset: relaxed\ncutoffs: { ask: 99, block: 100 }\ncategories: { rewrite_share: off, protected_path: off }\nprotected_paths: []\n');
    const rewrite = await call('apply_patch', patch('*** Update File: lib/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+x')).before();
    expect(rewrite).toMatchObject({ policy: { autoApprove: false } });
    await fs.mkdir(path.join(root, 'src', 'auth'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'auth', 'a.ts'), 'a\n');
    const c = call('apply_patch', patch('*** Update File: src/auth/a.ts', '@@', '-a', '+b'));
    await c.before();
    await c.after();
    const [risk] = (await events('risk-assessed')).filter(e => e.data.file === 'src/auth/a.ts');
    expect(risk.data.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'protected_path' })]));
    expect(plugin.configWarnings).toEqual([]);
  });

  it('observe mode: hard rules still block', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'mode: observe\n');
    const r = await call('apply_patch', patch('*** Update File: lib/small.ts', '@@', '-l1', '+// ... rest of code unchanged')).before();
    expect(r).toMatchObject({ skip: true });
    expect((r as { reason: string }).reason).toMatch(/placeholder/);
    expect((await events('edit-blocked'))[0].data.file).toBe('lib/small.ts');
  });

  it('observe mode: other asks are allowed and logged with the observe reason', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'mode: observe\n');
    const c = call('apply_patch', patch('*** Update File: lib/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+x'));
    expect(await c.before()).toBeUndefined();
    await c.after();
    const [risk] = await events('risk-assessed');
    expect(risk.data.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'observe', description: 'Observe mode: would have asked' })]));
  });

  it('editing the ClineShield config is blocked', async () => {
    const r = await call('editor', { path: path.join(root, '.cline-shield.yml'), new_text: 'mode: observe\n' }).before();
    expect(r).toMatchObject({ skip: true });
  });

  it('other tools and calls before setup pass through', async () => {
    expect(await call('read_files', { paths: ['x'] }).before()).toBeUndefined();
    const fresh = createClineShieldPlugin({ homeDir: home });
    expect(await fresh.hooks!.beforeTool!({ snapshot, tool: { name: 'editor' }, toolCall: { toolCallId: 'z', toolName: 'editor', input: {} }, input: {} })).toBeUndefined();
  });

  it('afterTool without a beforeTool decision re-scores from the patch alone', async () => {
    const c = call('apply_patch', patch('*** Update File: lib/small.ts', '@@', '-l1', '+// ... rest of code unchanged'));
    await c.after();
    const [risk] = await events('risk-assessed');
    expect(risk.data).toMatchObject({ file: 'lib/small.ts', level: 'high' });
    expect(risk.data.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'placeholder' })]));
    expect(await call('apply_patch', { input: 'garbage' }).after()).toBeUndefined();
  });

  it('a rubric crash asks the user (on_error: ask) and allows with on_error: allow', async () => {
    jest.spyOn(gather, 'gatherAction').mockRejectedValue(new Error('disk on fire'));
    const c = call('apply_patch', patch('*** Update File: lib/big.ts', '@@', '-l1', '+L1'));
    expect(await c.before()).toMatchObject({ policy: { autoApprove: false } });
    await c.after();
    expect((await events('risk-assessed'))).toEqual([]);
    expect((await events('edit-approval'))[0].data.file).toBe('(unparsed apply_patch input)');
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'on_error: allow\n');
    expect(await call('apply_patch', patch('*** Update File: lib/big.ts', '@@', '-l1', '+L1')).before()).toBeUndefined();
  });

  it('a 20,000-line file and patch score in under 200 ms', async () => {
    await fs.writeFile(path.join(root, 'lib', 'huge.ts'), lines(20000).join('\n') + '\n');
    const body = ['*** Update File: lib/huge.ts', '@@', ...lines(10000).map(l => `-${l}`), ...lines(10000, 'n').map(l => `+${l}`)];
    // The plugin is a long-lived worker: warm it once (JIT, config, CODEOWNERS), then time a typical call.
    await call('apply_patch', patch(...body)).before();
    const t = Date.now();
    await call('apply_patch', patch(...body)).before();
    expect(Date.now() - t).toBeLessThan(200);
  });
});
