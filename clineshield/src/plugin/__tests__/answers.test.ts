/**
 * The answers sidecar (SPEC.md "VS Code extension"): when a run's model call
 * sees the user's typed reply to the latest ClineShield refusal, the plugin
 * appends { sessionId, answeredAt, answer } to .cline-shield/answers.json so the
 * sidebar can stop showing the card as waiting.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createClineShieldPlugin } from '../index';
import type { ClineShieldPlugin } from '../index';
import type { AgentMessage } from '../types';
import { answerOf, findAnswer, readAnswers, appendAnswer } from '../answers';

const ASK = "ClineShield needs the user's approval, so nothing was changed. Why: x.";
const BLOCK = 'ClineShield blocked this action, so nothing was changed. Why: y.';

const call = (id: string): AgentMessage => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'apply_patch', input: { input: 'p' } }] });
/** Within a turn the runtime stores { error }. */
const refused = (id: string, reason: string): AgentMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'apply_patch', output: { error: reason }, isError: true }] });
/** After a turn boundary Cline rebuilds history and the output is that object's JSON string. */
const refusedRebuilt = (id: string, reason: string): AgentMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'apply_patch', output: JSON.stringify({ error: reason }), isError: true }] });
const said = (text: string): AgentMessage => ({ role: 'user', content: [{ type: 'text', text: `<user_input mode="act">${text}</user_input>` }] });
const assistant = (text: string): AgentMessage => ({ role: 'assistant', content: [{ type: 'text', text }] });
const snap = (messages: AgentMessage[], extra: Record<string, unknown> = {}) => ({ agentId: 'main', conversationId: 'c', runId: 'r', messages, ...extra });

describe('answerOf', () => {
  it.each([['yes', 'yes'], ['OK.', 'yes'], ['no', 'no'], ['No!', 'no'], ['nope', 'no'], ["don't", 'no'], ['no, use a smaller edit', 'other'], ['maybe later', 'other'], ['', 'other']])(
    '%p → %p', (text, answer) => expect(answerOf(text)).toBe(answer));
  it('undefined text (an attachment) → other', () => expect(answerOf(undefined)).toBe('other'));
});

describe('findAnswer', () => {
  it('no refusal → nothing', () => {
    expect(findAnswer(snap([said('hi'), assistant('hello'), said('no')]))).toBeUndefined();
  });
  it('a refusal with no reply yet → nothing', () => {
    expect(findAnswer(snap([said('edit'), call('c1'), refused('c1', ASK), assistant('Approve?')]))).toBeUndefined();
  });
  it('a reply after an ask, in rebuilt history (JSON string output)', () => {
    expect(findAnswer(snap([said('edit'), call('c1'), refusedRebuilt('c1', ASK), assistant('Approve?'), said('no')])))
      .toEqual({ toolCallId: 'c1', answer: 'no' });
  });
  it('uses the first reply after the latest refusal', () => {
    const m = [said('edit'), call('c1'), refused('c1', ASK), said('yes'), call('c2'), refused('c2', BLOCK), said('why?'), said('no')];
    expect(findAnswer(snap(m))).toEqual({ toolCallId: 'c2', answer: 'other' });
  });
  it('ignores error results that are not ClineShield refusals', () => {
    expect(findAnswer(snap([call('c1'), refused('c1', 'ENOENT: no such file'), said('no')]))).toBeUndefined();
  });
  it('ignores subagents', () => {
    expect(findAnswer(snap([call('c1'), refused('c1', ASK), said('no')], { parentAgentId: 'main' }))).toBeUndefined();
  });
  it('malformed snapshots → nothing, no throw', () => {
    expect(findAnswer(undefined)).toBeUndefined();
    expect(findAnswer({ agentId: 'main', messages: [null, 3, { role: 'user' }] as unknown as AgentMessage[] })).toBeUndefined();
  });
});

describe('answers plugin hook', () => {
  let root: string;
  let home: string;
  let plugin: ClineShieldPlugin;

  const fresh = (sessionId = 's1') => {
    const p = createClineShieldPlugin({ homeDir: home, pluginDir: '/nonexistent' });
    p.setup?.({}, { session: { sessionId }, workspaceInfo: { rootPath: root } });
    return p;
  };
  const model = async (p: ClineShieldPlugin, messages: AgentMessage[], extra: Record<string, unknown> = {}) => {
    const r = await p.hooks!.beforeModel!({ snapshot: snap(messages, extra), request: { messages: [] } });
    await p.flush();
    return r;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-ans-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    plugin = fresh();
  });
  afterEach(async () => {
    await plugin.flush();
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('records a "no" after an ask and changes nothing for the model', async () => {
    const before = Date.now();
    const r = await model(plugin, [said('edit'), call('c1'), refused('c1', ASK), assistant('Approve?'), said('no')]);
    expect(r).toBeUndefined();
    const { entries } = await readAnswers(root);
    expect(entries).toEqual([{ sessionId: 's1', toolCallId: 'c1', answeredAt: expect.any(String), answer: 'no' }]);
    expect(Date.parse(entries[0].answeredAt)).toBeGreaterThanOrEqual(before);
  });

  it('records once per refusal across model calls', async () => {
    const m = [said('edit'), call('c1'), refused('c1', ASK), said('yes')];
    await model(plugin, m);
    await model(plugin, [...m, call('c2'), assistant('done')]);
    expect((await readAnswers(root)).entries).toHaveLength(1);
  });

  it('one-shot: a fresh plugin per turn reading rebuilt history records once', async () => {
    const m = [said('edit'), call('c1'), refusedRebuilt('c1', BLOCK), assistant('Blocked.'), said('ok, skip it')];
    await model(fresh(), m);
    await model(fresh(), [...m, assistant('Skipped.'), said('thanks')]);
    expect((await readAnswers(root)).entries).toEqual([expect.objectContaining({ sessionId: 's1', toolCallId: 'c1', answer: 'other' })]);
  });

  it('nothing to record → no file', async () => {
    await model(plugin, [said('hi')]);
    await expect(fs.access(path.join(root, '.cline-shield', 'answers.json'))).rejects.toThrow();
  });

  it('never throws on a malformed context', async () => {
    await expect(plugin.hooks!.beforeModel!(undefined as never)).resolves.toBeUndefined();
    await expect(plugin.hooks!.beforeModel!({ snapshot: { agentId: 'main', messages: 'x' } } as never)).resolves.toBeUndefined();
  });

  it('a write failure is swallowed', async () => {
    // setup() writes session-start in the background, which creates .cline-shield/; wait for it, then replace it with a file.
    await plugin.flush();
    await fs.rm(path.join(root, '.cline-shield'), { recursive: true, force: true });
    await fs.writeFile(path.join(root, '.cline-shield'), 'not a dir');
    await expect(model(plugin, [call('c1'), refused('c1', ASK), said('no')])).resolves.toBeUndefined();
  });
});

describe('appendAnswer', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-ans-')); jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(async () => { jest.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

  it('concurrent appends keep every entry and skip duplicates', async () => {
    const e = (id: string) => ({ sessionId: 's1', toolCallId: id, answeredAt: new Date().toISOString(), answer: 'no' as const });
    await Promise.all([appendAnswer(root, e('a')), appendAnswer(root, e('b')), appendAnswer(root, e('a'))]);
    expect((await readAnswers(root)).entries.map(x => x.toolCallId)).toEqual(['a', 'b']);
  });

  it('keeps the newest 200', async () => {
    for (let i = 0; i < 205; i++) await appendAnswer(root, { sessionId: 's', toolCallId: `t${i}`, answeredAt: 'x', answer: 'other' });
    const { entries } = await readAnswers(root);
    expect(entries).toHaveLength(200);
    expect(entries[0].toolCallId).toBe('t5');
  });

  it('a corrupt file reads as empty', async () => {
    await fs.mkdir(path.join(root, '.cline-shield'));
    await fs.writeFile(path.join(root, '.cline-shield', 'answers.json'), '{nope');
    expect(await readAnswers(root)).toEqual({ entries: [] });
  });
});
