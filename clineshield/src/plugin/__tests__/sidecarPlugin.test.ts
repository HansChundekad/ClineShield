/**
 * Plugin-level tests for the diff sidecar: entries keyed to the logged
 * decision event, redacted, and never affecting the decision.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createClineShieldPlugin } from '../index';
import type { AgentToolResult, ClineShieldPlugin } from '../index';
import type { AgentMessage } from '../types';
import * as sidecar from '../sidecar';
import { SIDECAR_FILE, readSidecar } from '../sidecar';

type Event = { type: string; timestamp: string; sessionId: string; data: Record<string, unknown> };

const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);
const patchFor = (...body: string[]) => ({ input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n') });
const ASK_EDIT = patchFor('*** Update File: lib/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+x');
const BLOCK_EDIT = patchFor('*** Update File: lib/small.ts', '@@', ' l0', '-l1', '+// ... rest of code unchanged');
const SECRET_EDIT = patchFor('*** Update File: lib/small.ts', '@@', ' l0', '+const k = "AKIAABCDEFGHIJKLMNOP";');
const CLEAN_EDIT = patchFor('*** Update File: lib/small.ts', '@@', ' l0', '-l1', '+l1b');
const MANIFEST_EDIT = patchFor('*** Update File: package.json', '@@', ' {', '+  "private": true,');

const toolCall = (id: string, toolName: string, input: unknown): AgentMessage => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName, input }] });
const refusal = (id: string, toolName: string, reason: string): AgentMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName, output: { error: reason }, isError: true }] });
const said = (text: string): AgentMessage => ({ role: 'user', content: [{ type: 'text', text: `<user_input mode="act">${text}</user_input>` }] });

describe('diff sidecar (plugin)', () => {
  let root: string;
  let home: string;
  let plugin: ClineShieldPlugin;

  const run = (id: string, toolName: string, input: unknown, messages: AgentMessage[] = []) => {
    const toolCallPart = { toolCallId: id, toolName, input };
    const snapshot = { agentId: 'main', conversationId: 'c', runId: 'r', messages: [...messages, toolCall(id, toolName, input)] };
    const ctx = { snapshot, tool: { name: toolName }, toolCall: toolCallPart, input };
    return {
      before: () => plugin.hooks!.beforeTool!(ctx),
      after: (result: AgentToolResult = { output: 'ok' }) =>
        plugin.hooks!.afterTool!({ ...ctx, result, startedAt: new Date(), endedAt: new Date(), durationMs: 1 }),
    };
  };
  const events = async (type: string): Promise<Event[]> => {
    await plugin.flush();
    const all = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')) as Event[];
    return all.filter(e => e.type === type);
  };
  const entries = async () => { await plugin.flush(); return (await readSidecar(root)).entries; };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-side-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
    await fs.mkdir(path.join(root, 'lib'));
    await fs.writeFile(path.join(root, 'lib', 'small.ts'), lines(40).join('\n') + '\n');
    await fs.writeFile(path.join(root, 'package.json'), '{\n  "name": "x"\n}\n');
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

  it('a blocked edit writes one entry keyed to the edit-blocked event', async () => {
    await run('c1', 'apply_patch', BLOCK_EDIT).before();
    const [ev] = await events('edit-blocked');
    const es = await entries();
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ sessionId: ev.sessionId, timestamp: ev.timestamp, file: ev.data.file });
    expect(es[0].diff).toContain('+// ... rest of code unchanged');
  });

  it('a refused ask writes an entry keyed to approved:false; the approved retry adds none', async () => {
    const reason = ((await run('c1', 'apply_patch', ASK_EDIT).before()) as { reason: string }).reason;
    const [refused] = await events('edit-approval');
    expect(await entries()).toEqual([expect.objectContaining({ timestamp: refused.timestamp, file: 'lib/small.ts' })]);
    const retry = run('c2', 'apply_patch', ASK_EDIT, [toolCall('c1', 'apply_patch', ASK_EDIT), refusal('c1', 'apply_patch', reason), said('yes')]);
    expect(await retry.before()).toEqual({ policy: { autoApprove: true } });
    await retry.after();
    expect(await entries()).toHaveLength(1);
  });

  it('an allowed edit with points writes an entry keyed to edit-allowed', async () => {
    expect(await run('c1', 'apply_patch', MANIFEST_EDIT).before()).toBeUndefined();
    const [ev] = await events('edit-allowed').then(es => es.filter(e => e.data.file === 'package.json'));
    expect(await entries()).toEqual([expect.objectContaining({ timestamp: ev.timestamp, file: 'package.json' })]);
  });

  it('a clean edit and a command write no entry', async () => {
    await run('c1', 'apply_patch', CLEAN_EDIT).before();
    await run('c2', 'run_commands', { commands: ['sudo apt-get install jq'] }).before();
    expect(await entries()).toEqual([]);
  });

  it('a secret in the edit is redacted in the sidecar', async () => {
    await run('c1', 'apply_patch', SECRET_EDIT).before();
    const [e] = await entries();
    expect(e.diff).toContain('[REDACTED]');
    expect(JSON.stringify(await entries())).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });

  it('an unwritable sidecar does not change the decision or the logged event', async () => {
    await fs.mkdir(path.join(root, '.cline-shield', SIDECAR_FILE), { recursive: true });
    const r = await run('c1', 'apply_patch', BLOCK_EDIT).before();
    expect(r).toEqual({ skip: true, reason: expect.stringContaining('ClineShield blocked') });
    expect(await events('edit-blocked')).toHaveLength(1);
  });

  it('a throw while building sidecar entries does not change a block into an allow', async () => {
    jest.spyOn(sidecar, 'sidecarEntry').mockImplementation(() => { throw new Error('boom'); });
    const r = await run('c1', 'apply_patch', BLOCK_EDIT).before();
    expect(r).toEqual({ skip: true, reason: expect.stringContaining('ClineShield blocked') });
  });
});
