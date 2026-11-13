/** Reads tool calls and ClineShield's decisions from a Cline session record (`<id>.messages.json`). */
import type { Tier, ToolCall } from './types';

interface Block { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }
interface Message { role?: string; ts?: number; content?: unknown }

const asText = (c: unknown): string => (c === undefined || c === null ? '' : typeof c === 'string' ? c : JSON.stringify(c));

/** Every tool_use in order, paired with its tool_result. A call with no result is kept with result '' and isError true. */
export function extractToolCalls(runId: string, messagesJson: unknown): ToolCall[] {
  const messages = (messagesJson as { messages?: Message[] } | null)?.messages;
  if (!Array.isArray(messages)) return [];
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as Block[]) {
      if (b?.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, { text: asText(b.content), isError: b.is_error === true });
    }
  }
  const calls: ToolCall[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content as Block[]) {
      if (b?.type !== 'tool_use' || !b.id) continue;
      const r = results.get(b.id);
      calls.push({ runId, toolCallId: b.id, name: b.name ?? '', input: b.input, result: r?.text ?? '', isError: r ? r.isError : true, ts: m.ts ?? 0, order: calls.length });
    }
  }
  return calls;
}

const BLOCK_PREFIX = 'ClineShield blocked this action';
const ASK_PREFIX = "ClineShield needs the user's approval";

/** ClineShield's tier for a call, read from its result: a refusal is the whole result (or its JSON `error`), never text inside output. */
export function decisionFromResult(call: ToolCall): Tier {
  let text = call.result.trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') text = parsed.error;
    } catch { /* not JSON: use raw text */ }
  }
  if (text.startsWith(BLOCK_PREFIX)) return 'block';
  if (text.startsWith(ASK_PREFIX)) return 'ask';
  return 'allow';
}
