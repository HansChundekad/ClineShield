/**
 * approval.ts
 *
 * Decides whether an asked action may run: the conversation history must show
 * that this exact action was refused, that the user's next typed reply was a
 * plain yes, and that the yes has not been used. The history is written by the
 * Cline runtime, not the model. Anything unexpected means "not approved".
 */

import type { AgentRuntimeStateSnapshot } from '../types';

const YES_WORDS = new Set(['yes', 'y', 'yep', 'yeah', 'ok', 'okay', 'sure', 'approve', 'approved', 'go ahead', 'do it', 'proceed']);
const MODE_NOTICE = /<mode_notice>[\s\S]*?<\/mode_notice>/g;
const USER_INPUT = /^<user_input mode="(?:act|plan|yolo)">([\s\S]*)<\/user_input>$/;

/** A typed reply without the mode notice, trailing . or !, and case. */
export function normalizeReply(userText: string): string {
  return userText.replace(MODE_NOTICE, '').trim().replace(/[.!]+$/, '').trim().toLowerCase();
}

export function isPlainYes(userText: string): boolean {
  return YES_WORDS.has(normalizeReply(userText));
}

export interface ApprovalCheck {
  snapshot: AgentRuntimeStateSnapshot | undefined;
  primaryAgentId: string | undefined;
  toolCallId: string | undefined;
  reason: string;
}

type Part = Record<string, unknown>;
export type Entry =
  | { kind: 'call'; id: unknown; tool: unknown; key: string }
  | { kind: 'result'; id: unknown; refusal: unknown }
  | { kind: 'reply'; text: string | undefined };

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
  }) ?? '';
}

const isPart = (p: unknown): p is Part => typeof p === 'object' && p !== null;

/**
 * The refusal text of an error result. Within a turn the runtime stores
 * `{ error }`; between turns Cline saves history and rebuilds it, and the
 * output comes back as that object's JSON string (CLI 3.0.74).
 */
export function refusalOf(output: unknown): unknown {
  if (isPart(output)) return output.error;
  if (typeof output !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(output);
    return isPart(parsed) ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

/** A typed user turn, or undefined for other user-role messages (notices, hook context, summaries). */
function typedReply(parts: Part[]): Entry | undefined {
  const text = parts.filter(p => p.type === 'text').map(p => String(p.text)).join('').trim();
  const match = USER_INPUT.exec(text);
  if (!match) return undefined;
  return { kind: 'reply', text: parts.every(p => p.type === 'text') ? match[1] : undefined };
}

/** History as tool calls, error results and typed user replies, in order. */
export function flatten(messages: readonly unknown[]): Entry[] {
  const entries: Entry[] = [];
  for (const message of messages) {
    if (!isPart(message) || !Array.isArray(message.content)) continue;
    const parts = message.content.filter(isPart);
    if (message.role === 'user') {
      const reply = typedReply(parts);
      if (reply) entries.push(reply);
      continue;
    }
    for (const part of parts) {
      if (part.type === 'tool-call') {
        entries.push({ kind: 'call', id: part.toolCallId, tool: part.toolName, key: canonicalJson(part.input) });
      } else if (part.type === 'tool-result' && part.isError === true) {
        entries.push({ kind: 'result', id: part.toolCallId, refusal: refusalOf(part.output) });
      }
    }
  }
  return entries;
}

function check(c: ApprovalCheck): boolean {
  const s = c.snapshot;
  if (!s || !c.primaryAgentId || s.agentId !== c.primaryAgentId || s.parentAgentId) return false;
  if (c.toolCallId === undefined || !Array.isArray(s.messages)) return false;

  const entries = flatten(s.messages);
  const current = entries.map(e => e.kind === 'call' && e.id === c.toolCallId).lastIndexOf(true);
  if (current < 0) return false;

  // Compare the model's raw inputs from history. Hooks get a schema-normalized
  // input, so comparing that to history would let a re-encoded call dodge the "unused" check.
  const action = entries[current] as Extract<Entry, { kind: 'call' }>;
  const sameAction = (e: Entry) => e.kind === 'call' && e.tool === action.tool && e.key === action.key;
  const sameActionIds = new Set(entries.filter(sameAction).map(e => (e as { id: unknown }).id));

  let refusal = -1;
  for (let i = current - 1; i >= 0 && refusal < 0; i--) {
    const e = entries[i];
    if (e.kind === 'result' && e.refusal === c.reason && sameActionIds.has(e.id)) refusal = i;
  }
  if (refusal < 0) return false;

  let reply = -1;
  for (let i = refusal + 1; i < current && reply < 0; i++) {
    if (entries[i].kind === 'reply') reply = i;
  }
  if (reply < 0) return false;
  const answer = entries[reply] as { text: string | undefined };
  if (answer.text === undefined || !isPlainYes(answer.text)) return false;

  return !entries.slice(reply + 1, current).some(sameAction);
}

/** Never throws: the host fails open on a hook error, so an error here must mean "not approved". */
export function isApproved(c: ApprovalCheck): boolean {
  try {
    return check(c);
  } catch (error) {
    console.error('[ClineShield] approval check failed:', error);
    return false;
  }
}
