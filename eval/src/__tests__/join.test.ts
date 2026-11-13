import { describeAction } from '../actions';
import { joinMetrics } from '../join';
import type { MetricsEvent, ToolCall } from '../types';

const ROOT = '/work/notes-api';
const ASK = JSON.stringify({ error: "ClineShield needs the user's approval, so nothing was changed. Why: x" });
const BLOCK = JSON.stringify({ error: 'ClineShield blocked this action, so nothing was changed. Why: x' });
let n = 0;
const call = (name: string, input: unknown, result = '{"result":"ok"}', ts = 1000 + n): ToolCall =>
  ({ runId: 'r', toolCallId: `t${++n}`, name, input, result, isError: result !== '{"result":"ok"}', ts, order: n });
const ev = (type: string, data: Record<string, unknown>, ms = 5000): MetricsEvent => ({ timestamp: new Date(ms).toISOString(), type, data });
const edit = (file: string, extra: Record<string, unknown> = {}) => ({ file, structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0, ...extra });

describe('describeAction', () => {
  it('describes an editor replace with added and removed lines, path made relative', () => {
    const a = describeAction(call('editor', { command: 'str_replace', path: `${ROOT}/src/a.js`, old_text: 'old\nkeep', new_text: 'new\nkeep' }), ROOT);
    expect(a.kind).toBe('edit');
    expect(a.files).toEqual([{ path: 'src/a.js', op: 'update', added: ['new'], removed: ['old'] }]);
  });

  it('describes an apply_patch delete', () => {
    const a = describeAction(call('apply_patch', { input: '*** Begin Patch\n*** Delete File: src/utils/draft-export.js\n*** End Patch' }), ROOT);
    expect(a.files).toEqual([{ path: 'src/utils/draft-export.js', op: 'delete', added: [], removed: [] }]);
  });

  it('describes commands with the plugin display form', () => {
    const a = describeAction(call('run_commands', { commands: [{ command: 'git', args: ['reset', '--hard'] }, 'ls'] }), ROOT);
    expect(a.kind).toBe('command');
    expect(a.commands).toEqual(['git reset --hard', 'ls']);
    expect(a.displayCommand).toBe('git reset --hard; ls');
  });

  it('read-only tools are other', () => {
    expect(describeAction(call('read_files', { paths: ['a'] }), ROOT).kind).toBe('other');
  });
});

describe('joinMetrics', () => {
  it('joins an allowed edit to edit-allowed and risk-assessed', () => {
    const c = call('editor', { command: 'create', path: `${ROOT}/src/a.js`, new_text: 'x' });
    const [j] = joinMetrics([c], [ev('edit-allowed', edit('src/a.js')), ev('risk-assessed', { file: 'src/a.js', rulesScore: 15, level: 'low', reasons: [{ rule: 'manifest', points: 15, description: 'd' }] })], ROOT);
    expect(j).toMatchObject({ tier: 'allow', score: 15, reasons: [{ rule: 'manifest', points: 15 }], mismatch: null });
  });

  it('joins a blocked edit', () => {
    const c = call('editor', { command: 'create', path: `${ROOT}/src/b.js`, new_text: 'x' }, BLOCK);
    const [j] = joinMetrics([c], [ev('edit-blocked', edit('src/b.js', { reason: 'r', score: 100, reasons: [{ rule: 'secret_added', points: 0, description: 'd' }] }))], ROOT);
    expect(j).toMatchObject({ tier: 'block', score: 100, mismatch: null });
    expect(j.reasons.map(r => r.rule)).toEqual(['secret_added']);
  });

  it('joins parallel editor calls by file', () => {
    const c1 = call('editor', { command: 'create', path: `${ROOT}/a.js`, new_text: 'x' }, ASK);
    const c2 = call('editor', { command: 'create', path: `${ROOT}/b.js`, new_text: 'x' });
    const events = [ev('edit-allowed', edit('b.js')), ev('edit-approval', edit('a.js', { reason: 'r', approved: false, score: 45, reasons: [] }))];
    const [j1, j2] = joinMetrics([c1, c2], events, ROOT);
    expect(j1).toMatchObject({ tier: 'ask', score: 45, mismatch: null });
    expect(j2).toMatchObject({ tier: 'allow', mismatch: null });
    expect(j2.events[0].data.file).toBe('b.js');
  });

  it("joins a multi-command request using the plugin's display form", () => {
    const c = call('run_commands', { commands: [{ command: 'git', args: ['reset', '--hard'] }, 'ls'] }, ASK);
    const [j] = joinMetrics([c], [ev('command-assessed', { command: 'git reset --hard; ls', tier: 'ask', score: 50, reasons: [{ rule: 'discards_work', points: 50, description: 'd' }], approved: false })], ROOT);
    expect(j).toMatchObject({ tier: 'ask', score: 50, mismatch: null });
  });

  it('command with no event is allow with score 0', () => {
    const [j] = joinMetrics([call('run_commands', { commands: ['npm test'] })], [], ROOT);
    expect(j).toMatchObject({ tier: 'allow', score: 0, reasons: [], mismatch: null, events: [] });
  });

  it('flags a mismatch when result says block but event says allowed', () => {
    const c = call('editor', { command: 'create', path: `${ROOT}/c.js`, new_text: 'x' }, BLOCK);
    const [j] = joinMetrics([c], [ev('edit-allowed', edit('c.js'))], ROOT);
    expect(j.tier).toBe('block');
    expect(j.mismatch).toMatch(/result block, event allow/);
  });

  it('flags a refused call with no event', () => {
    const [j] = joinMetrics([call('run_commands', { commands: ['rm -rf /'] }, BLOCK)], [], ROOT);
    expect(j.mismatch).toMatch(/no metrics event/);
  });

  it('an approved retry (approval false then true) joins the refusal to the first call', () => {
    const input = { command: 'create', path: `${ROOT}/.env`, new_text: 'A=1' };
    const c1 = call('editor', input, ASK);
    const c2 = call('editor', input);
    const events = [ev('edit-approval', edit('.env', { reason: 'r', approved: false, score: 45, reasons: [] })), ev('edit-approval', edit('.env', { reason: 'r', approved: true, score: 45, reasons: [] }), 9000)];
    const [j1, j2] = joinMetrics([c1, c2], events, ROOT);
    expect(j1).toMatchObject({ tier: 'ask', mismatch: null });
    expect(j1.events[0].data.approved).toBe(false);
    expect(j2).toMatchObject({ tier: 'allow', mismatch: null });
    expect(j2.events[0].data.approved).toBe(true);
  });

  it('an allowed zero-score command does not steal a later refused event for the same text', () => {
    const c1 = call('run_commands', { commands: ['git reset --hard'] }, '{"result":"ok"}', 1000);
    const c2 = call('run_commands', { commands: ['git reset --hard'] }, ASK, 8000);
    const [j1, j2] = joinMetrics([c1, c2], [ev('command-assessed', { command: 'git reset --hard', tier: 'ask', score: 50, reasons: [], approved: false }, 8500)], ROOT);
    expect(j1).toMatchObject({ tier: 'allow', score: 0, events: [] });
    expect(j2).toMatchObject({ tier: 'ask', score: 50, mismatch: null });
  });
});
