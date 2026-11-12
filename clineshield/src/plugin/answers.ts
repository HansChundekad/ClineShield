/**
 * answers.ts
 *
 * The answers sidecar: <root>/.cline-shield/answers.json records the user's
 * typed reply to a ClineShield refusal (ask or block) so the VS Code sidebar
 * stops showing it as "Waiting on you" (SPEC.md "VS Code extension"). Read
 * from the conversation history, never from in-memory state, so one-shot
 * `cline --id <session>` runs (a new process per turn) work. One entry per
 * refusal (sessionId + toolCallId). Not a metrics.json event. Nothing here
 * changes what Cline is told or decides. Best effort: never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { AgentRuntimeStateSnapshot } from './types';
import { flatten, isPlainYes, normalizeReply } from './rubric/approval';
import { acquireLock } from '../metrics/writer';
import { sweepStaleTemps } from '../metrics/tempSweep';

export const ANSWERS_FILE = 'answers.json';
export const MAX_ANSWERS = 200;
export type Answer = 'yes' | 'no' | 'other';
export interface AnswerEntry { sessionId: string; toolCallId: string; answeredAt: string; answer: Answer }
export interface Answers { entries: AnswerEntry[] }

/** Strict on purpose: anything with more to say ("no, try X") is 'other'. */
const NO_WORDS = new Set(['no', 'n', 'nope', 'nah', 'no thanks', "don't", 'do not', 'dont', 'deny', 'denied', 'reject', 'decline', 'cancel', 'stop']);
/** askMessage and blockMessage (rubric/messages.ts) both start with this. */
const REFUSAL_PREFIX = 'ClineShield ';

export function answerOf(text: string | undefined): Answer {
  if (text === undefined) return 'other';
  if (isPlainYes(text)) return 'yes';
  return NO_WORDS.has(normalizeReply(text)) ? 'no' : 'other';
}

/** The latest ClineShield refusal and the first typed reply after it, for the user's own agent only. */
export function findAnswer(snapshot: AgentRuntimeStateSnapshot | undefined): { toolCallId: string; answer: Answer } | undefined {
  if (!snapshot || snapshot.parentAgentId || !Array.isArray(snapshot.messages)) return undefined;
  const entries = flatten(snapshot.messages);
  const refusal = entries.map(e => e.kind === 'result' && typeof e.refusal === 'string' && e.refusal.startsWith(REFUSAL_PREFIX)).lastIndexOf(true);
  if (refusal < 0) return undefined;
  const { id } = entries[refusal] as { id: unknown };
  if (typeof id !== 'string') return undefined;
  const reply = entries.slice(refusal + 1).find(e => e.kind === 'reply') as { text: string | undefined } | undefined;
  return reply ? { toolCallId: id, answer: answerOf(reply.text) } : undefined;
}

const answersPath = (root: string) => path.join(root, '.cline-shield', ANSWERS_FILE);

const isEntry = (e: unknown): e is AnswerEntry => {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  return typeof x.sessionId === 'string' && typeof x.toolCallId === 'string' && typeof x.answeredAt === 'string' &&
    (x.answer === 'yes' || x.answer === 'no' || x.answer === 'other');
};

export async function readAnswers(root: string): Promise<Answers> {
  try {
    const parsed = JSON.parse(await fs.readFile(answersPath(root), 'utf-8')) as { entries?: unknown };
    return { entries: Array.isArray(parsed?.entries) ? parsed.entries.filter(isEntry) : [] };
  } catch {
    return { entries: [] };
  }
}

/**
 * Appends run one at a time per process, and across processes (parallel
 * sessions each run their own plugin) under answers.json.lock, the same lock
 * as metrics.json: held for one read-modify-write; after 1 s busy we write
 * anyway rather than hold up the session. An entry already recorded for the
 * same refusal is skipped.
 */
let queue: Promise<boolean> = Promise.resolve(false);

/** Resolves true when the entry is in the file (written now or before). */
export function appendAnswer(root: string, entry: AnswerEntry): Promise<boolean> {
  const next = queue.then(() => appendNow(root, entry));
  queue = next;
  return next;
}

async function appendNow(root: string, entry: AnswerEntry): Promise<boolean> {
  const target = answersPath(root);
  const temp = `${target}.${randomUUID()}.tmp`;
  let release: (() => Promise<void>) | undefined;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    release = await acquireLock(`${target}.lock`);
    if (!release) console.error('[ClineShield] answers.json lock busy, writing without it');
    const existing = (await readAnswers(root)).entries;
    if (existing.some(e => e.sessionId === entry.sessionId && e.toolCallId === entry.toolCallId)) return true;
    const next: Answers = { entries: [...existing, entry].slice(-MAX_ANSWERS) };
    await sweepStaleTemps(target);
    await fs.writeFile(temp, JSON.stringify(next), 'utf-8');
    await fs.rename(temp, target);
    return true;
  } catch (error) {
    console.error('[ClineShield] answers sidecar not written:', (error as Error)?.message ?? error);
    await fs.rm(temp, { force: true }).catch(() => undefined);
    return false;
  } finally {
    await release?.().catch(() => undefined);
  }
}
