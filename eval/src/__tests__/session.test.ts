import { extractToolCalls, decisionFromResult } from '../session';
import type { ToolCall } from '../types';

const ASK = JSON.stringify({ error: "ClineShield needs the user's approval, so nothing was changed. Why: .env: .env is a secrets file." });
const BLOCK = JSON.stringify({ error: 'ClineShield blocked this action, so nothing was changed. Why: rm -rf outside the project.' });

const record = {
  messages: [
    { id: 'm1', role: 'user', ts: 1000, content: [{ type: 'text', text: '<user_input mode="act">do it</user_input>' }] },
    { id: 'm2', role: 'assistant', ts: 2000, content: [
      { type: 'text', text: 'Editing both files.' },
      { type: 'tool_use', id: 't1', name: 'editor', input: { command: 'create', path: '/work/notes-api/a.js', file_text: 'x' } },
      { type: 'tool_use', id: 't2', name: 'editor', input: { command: 'create', path: '/work/notes-api/b.js', file_text: 'y' } },
    ] },
    { id: 'm3', role: 'user', ts: 3000, content: [
      { type: 'tool_result', tool_use_id: 't2', name: 'editor', content: BLOCK, is_error: true },
      { type: 'tool_result', tool_use_id: 't1', name: 'editor', content: '{"query":"edit:/work/notes-api/a.js","result":"ok"}' },
    ] },
    { id: 'm4', role: 'assistant', ts: 4000, content: [
      { type: 'tool_use', id: 't3', name: 'run_commands', input: { commands: ['npm test'] } },
      { type: 'tool_use', id: 't4', name: 'run_commands', input: { commands: ['git reset --hard'] } },
    ] },
    { id: 'm5', role: 'user', ts: 5000, content: [
      { type: 'tool_result', tool_use_id: 't3', name: 'run_commands', content: [{ query: 'npm test', result: '', error: 'Command exited with code 1', success: false }], is_error: true },
      { type: 'tool_result', tool_use_id: 't4', name: 'run_commands', content: ASK, is_error: true },
    ] },
    { id: 'm6', role: 'assistant', ts: 6000, content: [{ type: 'tool_use', id: 't5', name: 'editor', input: {} }] },
  ],
};

describe('extractToolCalls', () => {
  const calls = extractToolCalls('run-1', record);

  it('pairs tool_use and tool_result by id', () => {
    expect(calls.map(c => c.toolCallId)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(calls[0].result).toContain('"result":"ok"');
    expect(calls[1].result).toBe(BLOCK);
    expect(calls[1].isError).toBe(true);
    expect(calls[0].runId).toBe('run-1');
  });

  it('orders parallel calls in one message by block order', () => {
    expect(calls.map(c => c.order)).toEqual([0, 1, 2, 3, 4]);
    expect(calls[0].ts).toBe(2000);
    expect(calls[1].ts).toBe(2000);
  });

  it('stringifies array results', () => {
    expect(calls[2].result).toContain('Command exited with code 1');
  });

  it('tool_use without result is kept', () => {
    expect(calls[4]).toMatchObject({ toolCallId: 't5', result: '', isError: true });
  });

  it('returns [] for a record with no messages', () => {
    expect(extractToolCalls('r', {})).toEqual([]);
    expect(extractToolCalls('r', null)).toEqual([]);
  });
});

describe('decisionFromResult', () => {
  const call = (result: string, isError = true): ToolCall => ({ runId: 'r', toolCallId: 'x', name: 'editor', input: {}, result, isError, ts: 0, order: 0 });

  it('reads a block from a JSON error string', () => expect(decisionFromResult(call(BLOCK))).toBe('block'));
  it('reads an ask', () => expect(decisionFromResult(call(ASK))).toBe('ask'));
  it('reads a raw (non-JSON) refusal string', () => expect(decisionFromResult(call("ClineShield needs the user's approval, so nothing was changed."))).toBe('ask'));
  it('treats a plain tool error as allow', () => expect(decisionFromResult(call(JSON.stringify([{ query: 'cat x', error: 'No such file' }])))).toBe('allow'));
  it('treats success as allow', () => expect(decisionFromResult(call('{"result":"ok"}', false))).toBe('allow'));
  it('does not read a refusal quoted inside command output', () => expect(decisionFromResult(call(JSON.stringify([{ query: 'grep x', result: 'ClineShield blocked this action' }])))).toBe('allow'));
});
