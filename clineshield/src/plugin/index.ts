/**
 * index.ts
 *
 * ClineShield 2.0 Cline plugin entry point (see SPEC.md Part 2).
 * Loaded by the Cline SDK through the root package.json `cline.plugins` entry.
 *
 * Session identity + session-start event, and the Risk rubric for file
 * edits: beforeTool parses apply_patch / editor input, gathers the files
 * (rubric/gather.ts), scores the action (rubric/engine.ts) under the
 * personal + project config (config/store.ts) and maps the tier to
 * allow · ask · block. afterTool records the user's decision on asked
 * actions and one risk-assessed event per file of every successful edit.
 */

import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { appendEvent } from '../metrics/writer';
import type { MetricsEvent } from '../types/metrics';
import { ConfigStore } from './config/store';
import type { RubricConfig } from './config/schema';
import { applyPatchInputText, editorInputToOperation, parseApplyPatch } from './patch';
import type { FileOperation } from './patch';
import { buildChange, gatherAction, readCodeowners } from './rubric/gather';
import { scoreAction } from './rubric/engine';
import type { Decision, FileScore } from './rubric/engine';
import { askMessage, blockMessage, REPEAT_BLOCK_NOTE } from './rubric/messages';
import type {
  AgentAfterToolContext,
  AgentToolResult,
  AgentAfterToolResult,
  AgentBeforeToolContext,
  AgentBeforeToolResult,
  AgentPlugin,
  PluginSetupContext,
} from './types';

export type { AgentToolResult } from './types';

const EDIT_TOOLS = new Set(['apply_patch', 'editor']);
const UNPARSED = (tool: string) => `(unparsed ${tool} input)`;

/** The plugin's own install folder (repo root of clineshield/src/plugin). */
const DEFAULT_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..');

function operationsFor(toolName: string, input: unknown): FileOperation[] | undefined {
  if (toolName === 'apply_patch') {
    const text = applyPatchInputText(input);
    const ops = text === undefined ? [] : parseApplyPatch(text).operations;
    return ops.length > 0 ? ops : undefined;
  }
  const op = editorInputToOperation(input);
  return op ? [op] : undefined;
}

/**
 * Appended by the SDK runtime to the skip reason when a tool approval is
 * denied, including headless runs with no approval callback. Copied from
 * cline/cline main @ 789f79e: sdk/packages/shared/src/llms/tools.ts L104,
 * used in sdk/packages/agents/src/agent-runtime.ts L2480.
 */
export const TOOL_REJECTION_SUFFIX = 'NOT a tool or system failure. Clarify with user before proceeding.';

/** True when an afterTool result is the runtime's "approval denied" error. */
export function isApprovalDenied(result: AgentToolResult | undefined): boolean {
  if (!result?.isError) return false;
  const output = result.output as { error?: unknown } | string | undefined;
  const text = typeof output === 'string' ? output : typeof output?.error === 'string' ? output.error : '';
  return text.includes(TOOL_REJECTION_SUFFIX);
}

/** Workspace-relative POSIX path when inside the workspace, else unchanged. */
function toDisplayPath(filePath: string, root: string | undefined): string {
  if (!root) return filePath;
  const rel = path.relative(root, path.resolve(root, filePath));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return filePath;
  return rel.split(path.sep).join('/');
}

/**
 * Wraps a hook so it can never throw into the Cline runtime. The host already
 * swallows hook errors (plugin-registry.ts), but silently; this logs them to
 * stderr and returns undefined (= no opinion).
 */
export function guardHook<C, R>(
  name: string,
  fn: (ctx: C) => R | undefined | Promise<R | undefined>
): (ctx: C) => Promise<R | undefined> {
  return async (ctx: C) => {
    try {
      return await fn(ctx);
    } catch (error) {
      console.error(`[ClineShield] ${name} hook failed:`, error);
      return undefined;
    }
  };
}

export interface ClineShieldPlugin extends AgentPlugin {
  readonly sessionId: string | undefined;
  readonly workspaceRoot: string | undefined;
  /** Config warnings seen this session (shown by `/clineshield` later). */
  readonly configWarnings: string[];
  flush(): Promise<void>;
}

export interface PluginOptions { homeDir?: string; pluginDir?: string }

/**
 * Creates a plugin instance. Cline runs one worker copy of the plugin per
 * session (plugin-registry.ts startWorkerCopy), but state is kept per
 * instance anyway so in-process hosts sharing the module stay correct.
 */
export function createClineShieldPlugin(options: PluginOptions = {}): ClineShieldPlugin {
  const homeDir = options.homeDir ?? os.homedir();
  const pluginDir = options.pluginDir ?? DEFAULT_PLUGIN_DIR;
  let sessionId: string | undefined;
  let workspaceRoot: string | undefined;
  let store: ConfigStore | undefined;
  let codeowners: Promise<string[]> | undefined;
  let warnedAllow = false;
  const configWarnings: string[] = [];
  const pending = new Set<Promise<void>>();
  /** Decisions by toolCallId: ask entries await afterTool; all feed risk-assessed. */
  const decided = new Map<string, { decision: Decision; asked: boolean; reason: string; observedTier?: 'ask' | 'block' }>();
  const blockCounts = new Map<string, number>();

  function record(event: MetricsEvent): void {
    if (!workspaceRoot) return;
    const write = appendEvent(event, workspaceRoot).finally(() => pending.delete(write));
    pending.add(write);
  }
  const sid = () => sessionId ?? 'unknown-session';
  const editData = (f: FileScore) => ({
    file: f.file, structuralChangePercent: f.structuralChangePercent, functionsDeleted: f.functionsDeleted, exportsDeleted: f.exportsDeleted,
  });

  async function loadConfig(): Promise<RubricConfig> {
    const { config, warnings } = await store!.get();
    for (const w of warnings) {
      if (!configWarnings.includes(w)) { configWarnings.push(w); console.error(`[ClineShield] config: ${w}`); }
    }
    if (config.onError === 'allow' && !warnedAllow) {
      warnedAllow = true;
      console.error('[ClineShield] on_error: allow — if ClineShield fails, actions run unchecked');
    }
    return config;
  }

  function errorDecision(file: string): Decision {
    return {
      tier: 'ask', errored: true, errors: [file],
      files: [{ file, score: 0, tier: 'ask', level: 'medium', cutoffs: { ask: 0, block: 100 }, findings: [], skipped: [], structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0 }],
    };
  }

  async function decide(toolName: string, input: unknown): Promise<{ decision: Decision; config: RubricConfig } | undefined> {
    const config = await loadConfig();
    const ops = operationsFor(toolName, input);
    if (!ops) {
      console.error(`[ClineShield] could not parse ${toolName} input`);
      return config.onError === 'ask' ? { decision: errorDecision(UNPARSED(toolName)), config } : undefined;
    }
    codeowners ??= readCodeowners(workspaceRoot!);
    const action = await gatherAction(ops, { workspaceRoot: workspaceRoot!, homeDir, pluginDir, codeownersGlobs: await codeowners });
    return { decision: scoreAction(action, config), config };
  }

  async function beforeTool(ctx: AgentBeforeToolContext): Promise<AgentBeforeToolResult | undefined> {
    const toolName = ctx.toolCall?.toolName ?? ctx.tool?.name;
    if (!EDIT_TOOLS.has(toolName) || !workspaceRoot) return undefined;
    store ??= new ConfigStore({ workspaceRoot, homeDir });
    let result: { decision: Decision; config: RubricConfig } | undefined;
    try {
      result = await decide(toolName, ctx.input);
    } catch (error) {
      console.error('[ClineShield] rubric failed:', error);
      const config = await loadConfig().catch(() => undefined);
      result = config?.onError === 'allow' ? undefined : { decision: errorDecision(UNPARSED(toolName)), config: config! };
    }
    if (!result) return undefined;
    const { decision, config } = result;
    const id = ctx.toolCall?.toolCallId;
    const timestamp = new Date().toISOString();

    if (config?.mode === 'observe' && decision.tier !== 'allow') {
      if (id !== undefined) decided.set(id, { decision, asked: false, reason: '', observedTier: decision.tier });
      for (const f of decision.files) record({ timestamp, sessionId: sid(), type: 'edit-allowed', data: editData(f) });
      return undefined;
    }

    if (decision.tier === 'block') {
      let reason = blockMessage(decision);
      const key = `${ctx.snapshot?.conversationId ?? ''}:${decision.files.find(f => f.tier === 'block')?.file ?? ''}`;
      const n = (blockCounts.get(key) ?? 0) + 1;
      blockCounts.set(key, n);
      if (n >= 3) reason += ` ${REPEAT_BLOCK_NOTE}`;
      for (const f of decision.files) record({ timestamp, sessionId: sid(), type: 'edit-blocked', data: { ...editData(f), reason } });
      return { skip: true, reason };
    }

    if (id !== undefined) decided.set(id, { decision, asked: decision.tier === 'ask', reason: decision.tier === 'ask' ? askMessage(decision) : '' });
    if (decision.tier === 'ask') {
      return { policy: { autoApprove: false }, appendContext: askMessage(decision) };
    }
    for (const f of decision.files) record({ timestamp, sessionId: sid(), type: 'edit-allowed', data: editData(f) });
    return undefined;
  }

  function recordRisk(decision: Decision, observedTier?: 'ask' | 'block'): void {
    const timestamp = new Date().toISOString();
    for (const f of decision.files) {
      if (f.file.startsWith('(unparsed')) continue;
      const reasons = [
        ...f.findings.map(x => ({ rule: x.id, points: x.points, description: x.detail })),
        ...f.skipped.map(s => ({ rule: `skipped:${s.split(':')[0]}`, points: 0, description: s })),
        ...(observedTier ? [{ rule: 'observe', points: 0, description: `Observe mode: would have ${observedTier === 'ask' ? 'asked' : 'blocked'}` }] : []),
      ];
      record({ timestamp, sessionId: sid(), type: 'risk-assessed', data: { file: f.file, rulesScore: f.score, level: f.level, reasons } });
    }
  }

  async function afterTool(ctx: AgentAfterToolContext): Promise<AgentAfterToolResult | undefined> {
    const toolName = ctx.toolCall?.toolName ?? ctx.tool?.name;
    if (!EDIT_TOOLS.has(toolName) || !workspaceRoot) return undefined;
    const id = ctx.toolCall?.toolCallId;
    const entry = id === undefined ? undefined : decided.get(id);
    if (id !== undefined) decided.delete(id);

    if (entry?.asked) {
      const approved = !isApprovalDenied(ctx.result);
      const timestamp = new Date().toISOString();
      for (const f of entry.decision.files) {
        record({ timestamp, sessionId: sid(), type: 'edit-approval', data: { ...editData(f), reason: entry.reason, approved } });
      }
    }
    if (ctx.result?.isError) return undefined;

    if (entry) { recordRisk(entry.decision, entry.observedTier); return undefined; }
    // No beforeTool decision (e.g. hook added mid-session): patch-only re-score; the file has already changed.
    const ops = operationsFor(toolName, ctx.input);
    if (!ops) return undefined;
    store ??= new ConfigStore({ workspaceRoot, homeDir });
    const config = await loadConfig();
    const root = workspaceRoot;
    const changes = ops.map(op => buildChange(op, { binary: false, outsideWorkspace: false }, p => toDisplayPath(p, root), path.resolve(root, op.path)));
    recordRisk(scoreAction({ workspaceRoot: root, homeDir, pluginDir, codeownersGlobs: [], changes }, config));
    return undefined;
  }

  return {
    name: 'clineshield',
    manifest: { capabilities: ['hooks'] },
    get sessionId() { return sessionId; },
    get workspaceRoot() { return workspaceRoot; },
    get configWarnings() { return configWarnings; },
    async flush() { await Promise.all([...pending]); },
    // Synchronous on purpose: no heavy work before the first model call.
    // The session-start write is fire-and-forget.
    setup(_api: unknown, ctx: PluginSetupContext): void {
      try {
        workspaceRoot = ctx?.workspaceInfo?.rootPath || ctx?.cwd || process.cwd();
        sessionId = ctx?.session?.sessionId || randomUUID();
      } catch (error) {
        console.error('[ClineShield] setup failed to read host context:', error);
        workspaceRoot = workspaceRoot || process.cwd();
        sessionId = sessionId || randomUUID();
      }

      // Same marker the VS Code extension writes on activation (extension.ts).
      record({
        timestamp: new Date().toISOString(),
        sessionId,
        type: 'edit-allowed',
        data: { file: 'session-start', structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0 },
      });
    },

    hooks: {
      beforeTool: guardHook<AgentBeforeToolContext, AgentBeforeToolResult>('beforeTool', beforeTool),
      afterTool: guardHook<AgentAfterToolContext, AgentAfterToolResult>('afterTool', afterTool),
    },
  };
}

const plugin = createClineShieldPlugin();

export { plugin };
export default plugin;
