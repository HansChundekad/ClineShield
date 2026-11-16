/**
 * Offline replay through the plugin's real beforeTool (design §8.1 (b), §8.3): timing and preset re-scoring with no model cost.
 * One plugin instance per (run, preset), calls in order, against the task's starting workspace.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { createClineShieldPlugin } from '../../clineshield/src/plugin';
import type { ClineShieldPlugin } from '../../clineshield/src/plugin';
import { describeAction } from './actions';
import { decisionFromResult } from './session';
import type { ReplayEntry } from './summary';
import type { Tier, ToolCall } from './types';

export type Preset = 'relaxed' | 'balanced' | 'strict';
const PRESETS: Preset[] = ['relaxed', 'balanced', 'strict'];
const MUTATING = new Set(['editor', 'apply_patch', 'run_commands']);
const CHANGES_FILES = /\b(git\s+(reset|checkout|restore|stash|clean|mv|rm|pull|merge|rebase|apply|am)|rm|mv|cp|sed\s+-i|perl\s+-i|truncate|npm\s+(i|install|ci|uninstall|add)|tee)\b|>/;

function makePlugin(workspace: string, preset: Preset): ClineShieldPlugin {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-home-'));
  if (preset !== 'balanced') fs.writeFileSync(path.join(home, '.cline-shield.yml'), `preset: ${preset}\n`);
  const plugin = createClineShieldPlugin({ homeDir: home, pluginDir: '/nonexistent' });
  plugin.setup?.({} as never, { session: { sessionId: `replay-${preset}` }, workspaceInfo: { rootPath: workspace } } as never);
  return plugin;
}

async function decide(plugin: ClineShieldPlugin, call: ToolCall): Promise<{ tier: Tier; ms: number }> {
  const toolCall = { toolCallId: call.toolCallId, toolName: call.name, input: call.input };
  const ctx = { snapshot: { agentId: 'replay', conversationId: 'replay', runId: 'replay' }, tool: { name: call.name }, toolCall, input: call.input };
  const t0 = performance.now();
  const r = (await plugin.hooks!.beforeTool!(ctx as never)) as { skip?: boolean; reason?: string } | undefined;
  const ms = performance.now() - t0;
  const tier = r?.skip ? decisionFromResult({ ...call, result: r.reason ?? '' }) : 'allow';
  return { tier, ms: Math.round(ms * 100) / 100 };
}

export async function replayCall(call: ToolCall, workspace: string, preset: Preset): Promise<{ tier: Tier; ms: number }> {
  const plugin = makePlugin(workspace, preset);
  try { return await decide(plugin, call); } finally { await plugin.flush(); }
}

/** Replays every mutating call at the three presets. approximate = an earlier call that ran may have changed what this one sees. */
export async function replayRun(calls: ToolCall[], workspace: string): Promise<Record<string, ReplayEntry>> {
  const plugins = Object.fromEntries(PRESETS.map(p => [p, makePlugin(workspace, p)])) as Record<Preset, ClineShieldPlugin>;
  const out: Record<string, ReplayEntry> = {};
  const touched = new Set<string>();
  let commandChanged = false;
  try {
    for (const call of calls) {
      if (!MUTATING.has(call.name)) continue;
      const action = describeAction(call, workspace);
      const approximate = commandChanged || action.files.some(f => touched.has(f.path));
      const entry = { approximate } as ReplayEntry;
      for (const p of PRESETS) entry[p] = await decide(plugins[p], call);
      out[call.toolCallId] = entry;
      if (decisionFromResult(call) === 'allow') {
        for (const f of action.files) touched.add(f.path);
        if (action.commands.some(c => CHANGES_FILES.test(c))) commandChanged = true;
      }
    }
  } finally {
    for (const p of PRESETS) await plugins[p].flush();
  }
  return out;
}
