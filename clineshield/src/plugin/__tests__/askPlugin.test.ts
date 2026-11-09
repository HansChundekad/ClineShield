/**
 * Plugin-level tests for "Ask through the conversation" (SPEC.md): the ask
 * tier refuses, and a real plain yes allows the identical action once.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createClineShieldPlugin } from '../index';
import type { AgentToolResult, ClineShieldPlugin } from '../index';
import type { AgentMessage } from '../types';
import { validateEvent } from './validateEvent';

type Event = { type: string; data: Record<string, unknown> };
type Before = { skip?: boolean; reason?: string; policy?: { autoApprove?: boolean } } | undefined;

const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);
const patchFor = (...body: string[]) => ({ input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n') });
const ASK_EDIT = patchFor('*** Update File: lib/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+x');
const BLOCK_EDIT = patchFor('*** Update File: lib/small.ts', '@@', ' l0', '-l1', '+// ... rest of code unchanged');
const ASK_COMMAND = { commands: ['sudo apt-get install jq'] };

const cases: Array<[string, string, unknown, string]> = [
  ['edit', 'apply_patch', ASK_EDIT, 'edit-approval'],
  ['command', 'run_commands', ASK_COMMAND, 'command-assessed'],
];

const toolCall = (id: string, toolName: string, input: unknown): AgentMessage => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName, input }] });
const refusal = (id: string, toolName: string, reason: string): AgentMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName, output: { error: reason }, isError: true }] });
const said = (text: string): AgentMessage => ({ role: 'user', content: [{ type: 'text', text: `<user_input mode="act">${text}</user_input>` }] });

describe('Ask through the conversation (plugin)', () => {
  let root: string;
  let home: string;
  let plugin: ClineShieldPlugin;

  const run = (id: string, toolName: string, input: unknown, messages: AgentMessage[] = [], agentId = 'main') => {
    const toolCallPart = { toolCallId: id, toolName, input };
    const snapshot = { agentId, conversationId: 'c', runId: 'r', messages: [...messages, toolCall(id, toolName, input)] };
    const ctx = { snapshot, tool: { name: toolName }, toolCall: toolCallPart, input };
    return {
      before: () => plugin.hooks!.beforeTool!(ctx) as Promise<Before>,
      after: (result: AgentToolResult = { output: 'ok' }) =>
        plugin.hooks!.afterTool!({ ...ctx, result, startedAt: new Date(), endedAt: new Date(), durationMs: 1 }),
    };
  };
  const events = async (type: string): Promise<Event[]> => {
    await plugin.flush();
    let all: Event[] = [];
    try { all = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')) as Event[]; } catch { /* none yet */ }
    for (const e of all) expect(validateEvent(e)).toEqual([]);
    return all.filter(e => e.type === type);
  };
  /** Refuses the action, then returns the history up to and including the user's reply. */
  const askedThenSaid = async (toolName: string, input: unknown, reply: string) => {
    const reason = (await run('c1', toolName, input).before())!.reason!;
    return [toolCall('c1', toolName, input), refusal('c1', toolName, reason), said(reply)];
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-ask-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
    await fs.mkdir(path.join(root, 'lib'));
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

  describe.each(cases)('%s', (_name, toolName, input, eventType) => {
    it('refuses with a reason telling Cline to ask, and logs approved:false', async () => {
      const r = await run('c1', toolName, input).before();
      expect(r).toEqual({ skip: true, reason: expect.stringContaining("needs the user's approval") });
      expect(r!.reason).toContain("If the user says no, don't retry the same action; ask them what they want.");
      expect(r!.reason).toContain('plain chat message');
      expect(r!.reason).not.toMatch(/\d+\s*points|cut-?off/i);
      const evs = await events(eventType);
      expect(evs).toHaveLength(1);
      expect(evs[0].data).toMatchObject({ approved: false });
    });

    it('after a plain yes the identical action runs once', async () => {
      const history = await askedThenSaid(toolName, input, 'yes');
      const ok = run('c2', toolName, input, history);
      expect(await ok.before()).toEqual({ policy: { autoApprove: true } });
      await ok.after();
      const evs = await events(eventType);
      expect(evs.map(e => e.data.approved)).toEqual([false, true]);

      const again = await run('c3', toolName, input, [...history, toolCall('c2', toolName, input)]).before();
      expect(again).toMatchObject({ skip: true });
    });

    it('a "no" keeps it refused', async () => {
      const history = await askedThenSaid(toolName, input, 'no');
      expect(await run('c2', toolName, input, history).before()).toMatchObject({ skip: true });
    });

    it('with no user present it stays refused (headless)', async () => {
      const history: AgentMessage[] = [];
      for (const id of ['c1', 'c2', 'c3']) {
        const r = await run(id, toolName, input, history).before();
        expect(r).toMatchObject({ skip: true });
        history.push(toolCall(id, toolName, input), refusal(id, toolName, r!.reason!));
      }
    });

    it('another agent cannot use the approval', async () => {
      const history = await askedThenSaid(toolName, input, 'yes');
      expect(await run('c2', toolName, input, history, 'teammate').before()).toMatchObject({ skip: true });
    });
  });

  it('after an approved edit, risk-assessed is written', async () => {
    const history = await askedThenSaid('apply_patch', ASK_EDIT, 'yes');
    const ok = run('c2', 'apply_patch', ASK_EDIT, history);
    await ok.before();
    await ok.after();
    expect(await events('risk-assessed')).toHaveLength(1);
  });

  it('a refused edit writes no risk-assessed in afterTool', async () => {
    const c = run('c1', 'apply_patch', ASK_EDIT);
    const r = await c.before();
    await c.after({ output: { error: r!.reason }, isError: true });
    expect(await events('risk-assessed')).toEqual([]);
    expect(await events('edit-approval')).toHaveLength(1);
  });

  it('a changed edit needs a new yes', async () => {
    const history = await askedThenSaid('apply_patch', ASK_EDIT, 'yes');
    const changed = patchFor('*** Update File: lib/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+y');
    expect(await run('c2', 'apply_patch', changed, history).before()).toMatchObject({ skip: true });
  });

  it('a block ignores a yes', async () => {
    const first = await run('c1', 'apply_patch', BLOCK_EDIT).before();
    expect(first!.reason).toMatch(/blocked/);
    const history = [toolCall('c1', 'apply_patch', BLOCK_EDIT), refusal('c1', 'apply_patch', first!.reason!), said('yes')];
    const r = await run('c2', 'apply_patch', BLOCK_EDIT, history).before();
    expect(r).toMatchObject({ skip: true, reason: expect.stringMatching(/blocked/) });
  });

  it('observe mode still lets an asked action through without a refusal', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'mode: observe\n');
    expect(await run('c1', 'apply_patch', ASK_EDIT).before()).toBeUndefined();
    expect(await events('edit-approval')).toEqual([]);
  });

  it('the first agent seen on any tool is the one that can be approved', async () => {
    await run('c0', 'read_files', { paths: ['a'] }, [], 'lead').before();
    const reason = (await run('c1', 'apply_patch', ASK_EDIT, [], 'teammate').before())!.reason!;
    const history = [toolCall('c1', 'apply_patch', ASK_EDIT), refusal('c1', 'apply_patch', reason), said('yes')];
    expect(await run('c2', 'apply_patch', ASK_EDIT, history, 'teammate').before()).toMatchObject({ skip: true });
  });
});
