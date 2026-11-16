import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { replayCall, replayRun } from '../replay';
import type { ToolCall } from '../types';

let n = 0;
const call = (name: string, input: unknown, result = '{"result":"ok"}'): ToolCall => ({ runId: 'r', toolCallId: `c${++n}`, name, input, result, isError: false, ts: 0, order: n });
const lines = (k: number, p: string) => Array.from({ length: k }, (_, i) => `const ${p}${i} = ${i};`).join('\n') + '\n';

describe('replay', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-rp-'));
    await fs.writeFile(path.join(root, 'big.js'), lines(40, 'a'));
    await fs.writeFile(path.join(root, 'notes.js'), 'export const x = 1;\n');
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root });
    g('init', '-q'); g('add', '.'); g('commit', '-qm', 'i');
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => { jest.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

  it('replays rm -rf / as block at balanced', async () => {
    expect((await replayCall(call('run_commands', { commands: ['rm -rf /'] }), root, 'balanced')).tier).toBe('block');
  });

  it('replays git reset --hard on a dirty tree as ask', async () => {
    await fs.appendFile(path.join(root, 'notes.js'), 'export const y = 2;\n');
    expect((await replayCall(call('run_commands', { commands: ['git reset --hard'] }), root, 'balanced')).tier).toBe('ask');
  });

  it('strict blocks a full rewrite that balanced asks', async () => {
    const c = call('editor', { command: 'str_replace', path: path.join(root, 'big.js'), old_text: lines(40, 'a'), new_text: lines(40, 'b') });
    expect((await replayCall(c, root, 'balanced')).tier).toBe('ask');
    expect((await replayCall(c, root, 'strict')).tier).toBe('block');
  });

  it('returns a positive ms', async () => {
    const r = await replayCall(call('run_commands', { commands: ['ls'] }), root, 'balanced');
    expect(r.tier).toBe('allow');
    expect(r.ms).toBeGreaterThan(0);
  });

  it('replayRun scores mutating calls at three presets and flags approximate ones', async () => {
    const calls = [
      call('read_files', { paths: ['notes.js'] }),
      call('editor', { command: 'str_replace', path: path.join(root, 'notes.js'), old_text: 'x = 1', new_text: 'x = 2' }),
      call('editor', { command: 'str_replace', path: path.join(root, 'notes.js'), old_text: 'x = 2', new_text: 'x = 3' }),
    ];
    const r = await replayRun(calls, root);
    expect(Object.keys(r)).toEqual([calls[1].toolCallId, calls[2].toolCallId]);
    expect(r[calls[1].toolCallId]).toMatchObject({ balanced: { tier: 'allow' }, relaxed: { tier: 'allow' }, strict: { tier: 'allow' }, approximate: false });
    expect(r[calls[2].toolCallId].approximate).toBe(true);
  });
});
