/**
 * types.ts
 *
 * Structural subset of the Cline SDK plugin types that ClineShield uses.
 * Mirrored by hand so the extension build and tests do not need `@cline/*`
 * installed (the plugin installer strips `@cline/*` deps anyway; the host
 * provides them). Field names match cline/cline `main` @ 789f79e:
 *   - AgentRuntimeStateSnapshot, AgentBeforeToolContext/Result,
 *     AgentAfterToolContext/Result: sdk/packages/shared/src/agent.ts
 *   - PluginSetupContext, AgentExtensionSessionContext, AgentExtension:
 *     sdk/packages/shared/src/extensions/contribution-registry.ts
 */

export interface AgentRuntimeStateSnapshot {
  agentId: string;
  conversationId?: string;
  runId?: string;
}

export interface AgentToolCallPart {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface AgentToolResult {
  output: unknown;
  isError?: boolean;
}

export interface AgentBeforeToolContext {
  snapshot: AgentRuntimeStateSnapshot;
  tool: { name: string };
  toolCall: AgentToolCallPart;
  input: unknown;
}

export interface AgentBeforeToolResult {
  skip?: boolean;
  stop?: boolean;
  reason?: string;
  input?: unknown;
  policy?: Record<string, unknown>;
  appendContext?: string;
}

export interface AgentAfterToolContext extends AgentBeforeToolContext {
  result: AgentToolResult;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
}

export interface AgentAfterToolResult {
  stop?: boolean;
  reason?: string;
  result?: AgentToolResult;
  appendContext?: string;
}

export interface PluginSetupContext {
  /** Core session metadata; `sessionId` is the host-owned session id. */
  session?: { sessionId?: string };
  /** `rootPath` is the workspace root; prefer it over `process.cwd()`. */
  workspaceInfo?: { rootPath?: string };
  /** Session working directory. */
  cwd?: string;
}

export interface AgentPluginHooks {
  beforeTool?: (
    ctx: AgentBeforeToolContext
  ) => AgentBeforeToolResult | undefined | Promise<AgentBeforeToolResult | undefined>;
  afterTool?: (
    ctx: AgentAfterToolContext
  ) => AgentAfterToolResult | undefined | Promise<AgentAfterToolResult | undefined>;
}

export interface AgentPlugin {
  name: string;
  manifest: { capabilities: string[] };
  hooks?: AgentPluginHooks;
  setup?: (api: unknown, ctx: PluginSetupContext) => void | Promise<void>;
}
