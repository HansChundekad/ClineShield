import { isApproved, isPlainYes } from '../approval';
import type { AgentMessage, AgentRuntimeStateSnapshot } from '../../types';

const REASON = 'ClineShield needs the user\'s approval. Why: x.';
const TOOL = 'run_commands';
const INPUT = { commands: ['sudo x'], cwd: '/a' };

const call = (id: string, input: unknown = INPUT, toolName = TOOL): AgentMessage => ({
  role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName, input }],
});
const result = (id: string, output: unknown, isError: boolean, toolName = TOOL): AgentMessage => ({
  role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName, output, isError }],
});
const refused = (id: string, reason = REASON, toolName = TOOL) => result(id, { error: reason }, true, toolName);
const user = (text: string): AgentMessage => ({ role: 'user', content: [{ type: 'text', text }] });
const said = (text: string, mode = 'act') => user(`<user_input mode="${mode}">${text}</user_input>`);
const ran = (id: string) => result(id, 'ok', false);

const snap = (messages: unknown, extra: object = {}) =>
  ({ agentId: 'main', conversationId: 'c', runId: 'r', messages, ...extra }) as AgentRuntimeStateSnapshot;

const check = (messages: unknown, over: object = {}) =>
  isApproved({ snapshot: snap(messages), primaryAgentId: 'main', toolCallId: 'c2', reason: REASON, ...over });

const asked = [call('c1'), refused('c1')];

describe('isPlainYes', () => {
  it.each(['yes', 'y', 'yep', 'yeah', 'ok', 'okay', 'sure', 'approve', 'approved', 'go ahead', 'do it', 'proceed', 'YES.', ' ok! ', 'Go Ahead'])('accepts %j', text => {
    expect(isPlainYes(text)).toBe(true);
  });
  it.each(['no', 'yes but skip tests', 'yes\n<file_content path="a">x</file_content>', '', 'not yes', 'yes no', '...'])('rejects %j', text => {
    expect(isPlainYes(text)).toBe(false);
  });
  it('removes a mode notice', () => {
    expect(isPlainYes('<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>yes')).toBe(true);
  });
});

describe('isApproved', () => {
  it('approves a retry after a plain yes', () => {
    expect(check([...asked, said('yes'), call('c2')])).toBe(true);
  });
  it('approves in any mode wrapper', () => {
    expect(check([...asked, said('ok', 'yolo'), call('c2')])).toBe(true);
  });
  it('rejects a retry with no reply', () => {
    expect(check([...asked, call('c2')])).toBe(false);
  });
  it.each(['no', 'yes but skip tests', 'yes\n<file_content path="a">x</file_content>'])('rejects the reply %j', text => {
    expect(check([...asked, said(text), call('c2')])).toBe(false);
  });
  it('treats a first "no" as final even if a yes follows', () => {
    expect(check([...asked, said('no'), said('yes'), call('c2')])).toBe(false);
  });
  it('ignores user-role messages that are not typed replies', () => {
    const summary: AgentMessage = { ...user('yes'), metadata: { kind: 'compaction_summary' } };
    expect(check([...asked, user('yes'), summary, user('<hook_context source="x">yes</hook_context>'), call('c2')])).toBe(false);
  });
  it('a later real no after a non-reply message is still the first reply', () => {
    expect(check([...asked, user('yes'), said('no'), call('c2')])).toBe(false);
  });
  it('ignores an ask_question answer', () => {
    expect(check([...asked, call('q', { question: 'ok?' }, 'ask_question'), result('q', 'yes', false, 'ask_question'), call('c2')])).toBe(false);
  });
  it('rejects a changed input', () => {
    expect(check([...asked, said('yes'), call('c2', { commands: ['sudo y'], cwd: '/a' })])).toBe(false);
  });
  it('ignores key order', () => {
    expect(check([...asked, said('yes'), call('c2', { cwd: '/a', commands: ['sudo x'] })])).toBe(true);
  });
  it('rejects a different tool', () => {
    expect(check([...asked, said('yes'), call('c2', INPUT, 'editor')])).toBe(false);
  });
  it('rejects a changed reason', () => {
    expect(check([...asked, said('yes'), call('c2')], { reason: `${REASON} New risk.` })).toBe(false);
  });
  it('rejects a matching result that was not an error', () => {
    expect(check([call('c1'), result('c1', { error: REASON }, false), said('yes'), call('c2')])).toBe(false);
  });
  it('allows only one use', () => {
    expect(check([...asked, said('yes'), call('c2'), ran('c2'), call('c3')], { toolCallId: 'c3' })).toBe(false);
  });
  it('a second yes does not renew a used approval', () => {
    expect(check([...asked, said('yes'), call('c2'), ran('c2'), said('yes'), call('c3')], { toolCallId: 'c3' })).toBe(false);
  });
  it('allows only the first of identical parallel calls', () => {
    const both: AgentMessage = { role: 'assistant', content: [...(call('c2').content as unknown[]), ...(call('c3').content as unknown[])] };
    const h = [...asked, said('yes'), both];
    expect(check(h)).toBe(true);
    expect(check(h, { toolCallId: 'c3' })).toBe(false);
  });
  it('a new refusal can be approved again', () => {
    expect(check([...asked, said('yes'), call('c2'), ran('c2'), call('c3'), refused('c3'), said('yes'), call('c4')], { toolCallId: 'c4' })).toBe(true);
  });
  it('one yes covers two different refused actions, once each', () => {
    const b = { commands: ['sudo b'] };
    const h = [...asked, call('b1', b), refused('b1'), said('yes'), call('c2'), call('b2', b)];
    expect(check(h)).toBe(true);
    expect(check(h, { toolCallId: 'b2' })).toBe(true);
  });
  it('a differently encoded retry does not match the refused action', () => {
    expect(check([...asked, said('yes'), call('c2', { commands: '["sudo x"]', cwd: '/a' })])).toBe(false);
  });
  it('a string-encoded action can be approved once and not replayed', () => {
    const raw = { commands: '["sudo x"]', cwd: '/a' };
    const h = [call('c1', raw), refused('c1'), said('yes'), call('c2', raw), ran('c2'), call('c3', raw)];
    expect(check(h)).toBe(true);
    expect(check(h, { toolCallId: 'c3' })).toBe(false);
  });
  it('a reused tool call id cannot replay an approval', () => {
    expect(check([...asked, said('yes'), call('c2'), ran('c2'), call('c2')])).toBe(false);
  });
  it('rejects a subagent', () => {
    const m = [...asked, said('yes'), call('c2')];
    expect(check(m, { snapshot: snap(m, { parentAgentId: 'p' }) })).toBe(false);
  });
  it('rejects a teammate (agent other than the first seen)', () => {
    expect(check([...asked, said('yes'), call('c2')], { primaryAgentId: 'lead' })).toBe(false);
  });
  it('rejects when no primary agent is known', () => {
    expect(check([...asked, said('yes'), call('c2')], { primaryAgentId: undefined })).toBe(false);
  });
  it('rejects when the current call is missing or has no id', () => {
    expect(check([...asked, said('yes')])).toBe(false);
    expect(check([...asked, said('yes'), call('c2')], { toolCallId: undefined })).toBe(false);
  });
  it('rejects a reply with a non-text part', () => {
    const withImage: AgentMessage = { role: 'user', content: [{ type: 'text', text: '<user_input mode="act">yes</user_input>' }, { type: 'image', image: 'x' }] };
    expect(check([...asked, withImage, call('c2')])).toBe(false);
  });
  it.each([
    ['undefined messages', undefined],
    ['non-array messages', 'x'],
    ['string content', [{ role: 'user', content: 'yes' }, call('c2')]],
    ['null entries', [null, ...asked, said('yes'), null, call('c2')].slice(0, 1)],
    ['string tool output', [call('c1'), result('c1', 'nope', true), said('yes'), call('c2')]],
  ])('malformed history (%s) is not approved and does not throw', (_n, m) => {
    expect(check(m)).toBe(false);
  });
  it('undefined snapshot is not approved', () => {
    expect(isApproved({ snapshot: undefined, primaryAgentId: 'main', toolCallId: 'c2', reason: REASON })).toBe(false);
  });
});
