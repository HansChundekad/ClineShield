/**
 * Plugin-level tests for session memory (SPEC.md "Risk rubric" ④): afterTool
 * feeds test runs, reads and edits into the store; beforeTool scores with it.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createClineShieldPlugin } from '../index';
import type { AgentToolResult, ClineShieldPlugin } from '../index';
import type { AgentMessage } from '../types';
import { validateEvent } from './validateEvent';

type Reason = { rule: string; points: number; description: string };
type Event = { type: string; data: { file?: string; reasons?: Reason[] } & Record<string, unknown> };
type Before = { skip?: boolean; reason?: string; policy?: { autoApprove?: boolean } } | undefined;

const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);
const patch = (...body: string[]) => ({ input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n') });
const SMALL_EDIT = patch('*** Update File: src/small.ts', '@@', ' l0', '-l1', '+L1');
const PAIR_EDIT = patch('*** Update File: src/a.test.ts', '@@', '-t1', '+T1', '*** Update File: src/a.ts', '@@', '-s1', '+S1');
const ASK_EDIT = patch('*** Update File: src/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+x');
const runResult = (...o: Array<{ success: boolean; error?: string }>): AgentToolResult => ({ output: o.map(x => ({ query: 'q', result: '', ...x })) });
const FAILED = runResult({ success: false, error: 'Command exited with code 1' });
const PASSED = runResult({ success: true });

const toolCall = (id: string, toolName: string, input: unknown): AgentMessage => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName, input }] });
const refusal = (id: string, toolName: string, reason: string): AgentMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName, output: { error: reason }, isError: true }] });
const said = (text: string): AgentMessage => ({ role: 'user', content: [{ type: 'text', text: `<user_input mode="act">${text}</user_input>` }] });

describe('session memory (plugin)', () => {
  let root: string;
  let home: string;
  let plugin: ClineShieldPlugin;
  let seq = 0;

  const call = (toolName: string, input: unknown, messages: AgentMessage[] = [], id = `c${++seq}`) => {
    const toolCallPart = { toolCallId: id, toolName, input };
    const snapshot = { agentId: 'main', conversationId: 'conv', runId: 'r', messages: [...messages, toolCall(id, toolName, input)] };
    const ctx = { snapshot, tool: { name: toolName }, toolCall: toolCallPart, input };
    return {
      before: () => plugin.hooks!.beforeTool!(ctx) as Promise<Before>,
      after: (result: AgentToolResult = { output: 'ok' }) =>
        plugin.hooks!.afterTool!({ ...ctx, result, startedAt: new Date(), endedAt: new Date(), durationMs: 1 }),
    };
  };
  const edit = async (input: unknown = SMALL_EDIT) => { const c = call('apply_patch', input); await c.before(); await c.after(); };
  const testRun = (result: AgentToolResult, cmd = 'npm test') => call('run_commands', { commands: [cmd] }).after(result);
  const read = (paths: string[], result: AgentToolResult = { output: paths.map(() => ({ success: true })) }) =>
    call('read_files', { files: paths.map(p => ({ path: p })) }).after(result);
  const events = async (type: string): Promise<Event[]> => {
    await plugin.flush();
    let all: Event[] = [];
    try { all = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')) as Event[]; } catch { /* none yet */ }
    for (const e of all) expect(validateEvent(e)).toEqual([]);
    return all.filter(e => e.type === type);
  };
  const lastReasons = async (file: string): Promise<Reason[]> => {
    const evs = (await events('risk-assessed')).filter(e => e.data.file === file);
    return evs[evs.length - 1]?.data.reasons ?? [];
  };
  const rule = (rs: Reason[], id: string) => rs.find(r => r.rule === id);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sess-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'small.ts'), lines(40).join('\n') + '\n');
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 's0\ns1\ns2\n');
    await fs.writeFile(path.join(root, 'src', 'a.test.ts'), 't0\nt1\nt2\n');
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'i');
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

  it('failed test run then test+source edit logs test_and_source 30; after a pass 15', async () => {
    await read(['src/a.ts', 'src/a.test.ts']);
    await testRun(FAILED);
    await edit(PAIR_EDIT);
    const failed = (await events('risk-assessed')).flatMap(e => e.data.reasons ?? []);
    expect(rule(failed, 'test_and_source')).toMatchObject({ points: 30, description: expect.stringMatching(/after a failed test run/) });
    await testRun(PASSED);
    await edit(PAIR_EDIT);
    const all = (await events('risk-assessed')).slice(-2).flatMap(e => e.data.reasons ?? []);
    expect(rule(all, 'test_and_source')).toMatchObject({ points: 15 });
  });

  it('unknown outcomes and non-test commands leave the last outcome alone', async () => {
    await read(['src/a.ts', 'src/a.test.ts']);
    await testRun(FAILED, 'npm run build');
    await testRun(runResult({ success: false, error: 'Command timed out after 10ms' }));
    await testRun(FAILED, 'npm test | tail');
    await edit(PAIR_EDIT);
    expect(rule((await events('risk-assessed')).flatMap(e => e.data.reasons ?? []), 'test_and_source')).toMatchObject({ points: 15 });
  });

  it('skipped edits (isError) are not recorded', async () => {
    await read(['src/small.ts']);
    for (let i = 0; i < 5; i++) {
      const c = call('apply_patch', SMALL_EDIT);
      await c.before();
      await c.after({ output: { error: 'skipped' }, isError: true });
    }
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'edit_loop')).toBeUndefined();
  });

  it('five edits in a row log edit_loop with 0 points', async () => {
    await read(['src/small.ts']);
    for (let i = 0; i < 4; i++) await edit();
    expect(rule(await lastReasons('src/small.ts'), 'edit_loop')).toBeUndefined();
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'edit_loop')).toEqual({ rule: 'edit_loop', points: 0, description: 'edit 5 of this file in 10 minutes (would add 15)' });
  });

  it('parallel afterTools are all recorded', async () => {
    await read(['src/small.ts']);
    const calls = Array.from({ length: 4 }, () => call('apply_patch', SMALL_EDIT));
    await Promise.all(calls.map(c => c.before()));
    await Promise.all(calls.map(c => c.after()));
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'edit_loop')?.description).toMatch(/^edit 5 of/);
  });

  it('unread_file fires for an unread existing file; an absolute read path matches the edit', async () => {
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'unread_file')).toEqual({ rule: 'unread_file', points: 0, description: 'edits src/small.ts without reading it first (would add 10)' });
    await read([path.join(root, 'src', 'a.ts')]);
    await edit(patch('*** Update File: src/a.ts', '@@', '-s1', '+S1'));
    expect(rule(await lastReasons('src/a.ts'), 'unread_file')).toBeUndefined();
  });

  it('a file Cline edited counts as read afterwards', async () => {
    await edit();
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'unread_file')).toBeUndefined();
  });

  it('read_files with isError or a failed entry records nothing', async () => {
    await read(['src/small.ts'], { output: { error: 'skipped' }, isError: true });
    await read(['src/small.ts'], { output: [{ success: false, error: 'nope' }] });
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'unread_file')).toBeDefined();
  });

  it('an approved ask records one edit', async () => {
    await read(['src/small.ts']);
    const reason = (await call('apply_patch', ASK_EDIT, [], 'a1').before())!.reason!;
    const history = [toolCall('a1', 'apply_patch', ASK_EDIT), refusal('a1', 'apply_patch', reason), said('yes')];
    const ok = call('apply_patch', ASK_EDIT, history);
    expect(await ok.before()).toEqual({ policy: { autoApprove: true } });
    await ok.after();
    for (let i = 0; i < 3; i++) await edit();
    expect(rule(await lastReasons('src/small.ts'), 'edit_loop')).toBeUndefined();
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'edit_loop')?.description).toMatch(/^edit 5 of/);
  });

  it('category off removes a session signal', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'categories:\n  unread_file: off\n');
    await edit();
    expect(rule(await lastReasons('src/small.ts'), 'unread_file')).toBeUndefined();
  });

  it('real session replay: failed run, cat reads, two parallel editor calls → test_and_source 30, no unread_file', async () => {
    const cat = call('run_commands', { commands: [`cd ${root} && cat src/a.test.ts && echo '---' && cat src/a.ts 2>/dev/null || true`] });
    await cat.after(runResult({ success: true }));
    await call('run_commands', { commands: [`cd ${root} && npm test 2>&1`] }).after(FAILED);
    const src = call('editor', { path: path.join(root, 'src', 'a.ts'), old_text: 's1', new_text: 'S1' });
    const tst = call('editor', { path: path.join(root, 'src', 'a.test.ts'), old_text: 't1', new_text: 't1\nT2' });
    await src.before();
    await tst.before();
    await Promise.all([src.after(), tst.after()]);
    const reasons = (await events('risk-assessed')).flatMap(e => e.data.reasons ?? []);
    expect(rule(reasons, 'test_and_source')).toMatchObject({ points: 30, description: 'changes src/a.ts and its test src/a.test.ts within 10 minutes, after a failed test run' });
    expect(rule(reasons, 'unread_file')).toBeUndefined();
  });

  it('second real session replay: `npm test 2>&1; echo "EXIT_CODE=$?"` failing → test_and_source 30', async () => {
    const cmd = `cd ${root} && npm test 2>&1; echo "EXIT_CODE=$?"`;
    await call('run_commands', { commands: [cmd] }).after({ output: [{ query: cmd, result: '> test\nAssertionError\n\nEXIT_CODE=1\n', success: true }] });
    await read([path.join(root, 'src', 'a.ts'), path.join(root, 'src', 'a.test.ts')]);
    const src = call('editor', { path: path.join(root, 'src', 'a.ts'), old_text: 's1', new_text: 'S1' });
    const tst = call('editor', { path: path.join(root, 'src', 'a.test.ts'), old_text: 't1', new_text: 't1\nT2' });
    await src.before();
    await tst.before();
    await Promise.all([src.after(), tst.after()]);
    const reasons = (await events('risk-assessed')).flatMap(e => e.data.reasons ?? []);
    expect(rule(reasons, 'test_and_source')).toMatchObject({ points: 30, description: expect.stringMatching(/after a failed test run$/) });
    expect(rule(reasons, 'unread_file')).toBeUndefined();
  });

  it('a refused edit does not pair with a later one', async () => {
    await read(['src/a.ts', 'src/a.test.ts']);
    const c = call('apply_patch', patch('*** Update File: src/a.test.ts', '@@', '-t1', '+T1'));
    await c.before();
    await c.after({ output: { error: 'skipped' }, isError: true });
    await edit(patch('*** Update File: src/a.ts', '@@', '-s1', '+S1'));
    expect(rule(await lastReasons('src/a.ts'), 'test_and_source')).toBeUndefined();
  });

  it('timing: scoring with a full 500-file store adds little', async () => {
    const time = async () => {
      const ts: number[] = [];
      for (let i = 0; i < 7; i++) { const t = process.hrtime.bigint(); await call('apply_patch', SMALL_EDIT).before(); ts.push(Number(process.hrtime.bigint() - t) / 1e6); }
      return ts.sort((a, b) => a - b)[3];
    };
    await time(); // warm up
    const empty = await time();
    await read(Array.from({ length: 500 }, (_, i) => `src/f${i}.ts`));
    for (let i = 0; i < 20; i++) await edit();
    const full = await time();
    // eslint-disable-next-line no-console
    console.log(`[timing] beforeTool median: empty store ${empty.toFixed(1)} ms, 500-file store ${full.toFixed(1)} ms`);
    expect(full - empty).toBeLessThan(20);
  });
});
