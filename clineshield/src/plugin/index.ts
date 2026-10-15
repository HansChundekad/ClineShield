/**
 * index.ts
 *
 * ClineShield 2.0 Cline plugin entry point (see SPEC.md Part 2).
 * Loaded by the Cline SDK through the root package.json `cline.plugins` entry.
 *
 * Session identity + session-start event, and the Edit Size Policy:
 * beforeTool classifies apply_patch / editor edits to TS/JS files
 * (editPolicy/policy.ts) as allow · approve · block; afterTool records the
 * user's decision on edits that were sent to approval.
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import { appendEvent } from '../metrics/writer';
import type { MetricsEvent } from '../types/metrics';
import { evaluateEdit } from './editPolicy/policy';
import type { FileVerdict } from './editPolicy/policy';
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

export interface ClineShieldPlugin extends AgentPlugin {
  /** Session id stamped on every event; set by setup(). */
  readonly sessionId: string | undefined;
  /** Workspace root that metrics.json lives under; set by setup(). */
  readonly workspaceRoot: string | undefined;
  /** Resolves once every event queued so far has been written. */
  flush(): Promise<void>;
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

/**
 * Creates a plugin instance. Cline runs one worker copy of the plugin per
 * session (plugin-registry.ts startWorkerCopy), but state is kept per
 * instance anyway so in-process hosts sharing the module stay correct.
 */
export function createClineShieldPlugin(): ClineShieldPlugin {
  let sessionId: string | undefined;
  let workspaceRoot: string | undefined;
  const pending = new Set<Promise<void>>();
  /** Edits sent to user approval, by toolCallId, awaiting afterTool. */
  const awaitingApproval = new Map<string, { files: FileVerdict[]; reason: string }>();

  function record(event: MetricsEvent): void {
    if (!workspaceRoot) return;
    const write = appendEvent(event, workspaceRoot).finally(() => pending.delete(write));
    pending.add(write);
  }

  function editData(f: FileVerdict) {
    const { structuralChangePercent, functionsDeleted, exportsDeleted } = f.measurement;
    return { file: f.file, structuralChangePercent, functionsDeleted, exportsDeleted };
  }

  function beforeTool(ctx: AgentBeforeToolContext): AgentBeforeToolResult | undefined {
    const toolName = ctx.toolCall?.toolName ?? ctx.tool?.name;
    const decision = evaluateEdit(toolName, ctx.input, { displayPath: p => toDisplayPath(p, workspaceRoot) });
    if (!decision) return undefined;
    const timestamp = new Date().toISOString();
    const sid = sessionId ?? 'unknown-session';

    if (decision.tier === 'block') {
      for (const f of decision.files) {
        record({ timestamp, sessionId: sid, type: 'edit-blocked', data: { ...editData(f), reason: decision.message } });
      }
      return { skip: true, reason: decision.message };
    }

    if (decision.tier === 'approve') {
      awaitingApproval.set(ctx.toolCall.toolCallId, { files: decision.files, reason: decision.message });
      return { policy: { autoApprove: false }, appendContext: decision.message };
    }

    for (const f of decision.files) {
      record({ timestamp, sessionId: sid, type: 'edit-allowed', data: editData(f) });
    }
    return undefined;
  }

  function afterTool(ctx: AgentAfterToolContext): AgentAfterToolResult | undefined {
    const id = ctx.toolCall?.toolCallId;
    const awaiting = id === undefined ? undefined : awaitingApproval.get(id);
    if (!awaiting) return undefined;
    awaitingApproval.delete(id);

    const approved = !isApprovalDenied(ctx.result);
    const timestamp = new Date().toISOString();
    for (const f of awaiting.files) {
      record({
        timestamp,
        sessionId: sessionId ?? 'unknown-session',
        type: 'edit-approval',
        data: { ...editData(f), reason: awaiting.reason, approved },
      });
    }
    return undefined;
  }

  return {
    name: 'clineshield',
    manifest: { capabilities: ['hooks'] },

    get sessionId() {
      return sessionId;
    },
    get workspaceRoot() {
      return workspaceRoot;
    },

    async flush() {
      await Promise.all([...pending]);
    },

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
