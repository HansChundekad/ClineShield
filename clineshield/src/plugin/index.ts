/**
 * index.ts
 *
 * ClineShield 2.0 Cline plugin entry point (see SPEC.md Part 2).
 * Loaded by the Cline SDK through the root package.json `cline.plugins` entry.
 *
 * Foundation only: session identity + session-start event. beforeTool /
 * afterTool are guarded no-ops until the edit policy and checks land.
 */

import { randomUUID } from 'crypto';
import { appendEvent } from '../metrics/writer';
import type { MetricsEvent } from '../types/metrics';
import type {
  AgentAfterToolContext,
  AgentAfterToolResult,
  AgentBeforeToolContext,
  AgentBeforeToolResult,
  AgentPlugin,
  PluginSetupContext,
} from './types';

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

  function record(event: MetricsEvent): void {
    if (!workspaceRoot) return;
    const write = appendEvent(event, workspaceRoot).finally(() => pending.delete(write));
    pending.add(write);
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
      beforeTool: guardHook<AgentBeforeToolContext, AgentBeforeToolResult>('beforeTool', () => undefined),
      afterTool: guardHook<AgentAfterToolContext, AgentAfterToolResult>('afterTool', () => undefined),
    },
  };
}

const plugin = createClineShieldPlugin();

export { plugin };
export default plugin;
