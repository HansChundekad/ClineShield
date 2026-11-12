/**
 * explain.ts
 *
 * On-click explanation of one sidebar item (design: on click only, key from
 * SecretStorage). Gathers the sidecar diff and contents of every file, redacts secrets from
 * everything sent, and spaces Gemini calls >= 6 s apart. Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ActionItem } from '../../sidebar/dashboard';
import { readSidecar } from '../../plugin/sidecar';
import { redactSecrets } from '../../plugin/rubric/redact';
import { isSecretsFile } from '../../plugin/rubric/paths';
import { callGemini } from './llmAnalyzer';
import type { GeminiResult } from './llmAnalyzer';

export const MAX_FILE_CHARS = 8000;
export const GEMINI_MIN_INTERVAL_MS = 6000;
const TRUNCATED = '\n... [truncated]';

export interface ExplainDeps {
  root: string;
  getKey: () => Promise<string | undefined>;
  caller?: typeof callGemini;
  readFile?: (abs: string) => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** One file of an edit as sent to Gemini (unredacted here; the prompt redacts). */
export interface ExplainFile { file: string; diff: string; contents: string }

const VERB = { allow: 'allowed', ask: 'asked the user about', block: 'blocked' } as const;

export function buildExplainPrompt(item: ActionItem, files: ExplainFile[]): string {
  const r = redactSecrets;
  const reasons = item.reasons?.length
    ? item.reasons.map(x => `- ${r(x.description)} (+${x.points})`).join('\n')
    : `- ${r(item.reasonText ?? 'none recorded')}`;
  const score = item.score === null ? 'unscored' : `${item.score}/100`;
  const cutoffs = item.cutoffs ? ` (ask at ${item.cutoffs.ask}, block at ${item.cutoffs.block})` : '';
  const pending = item.tier === 'allow' ? '' : '\nThis action has not run: ClineShield stopped it before it ran.';
  const subject = item.kind === 'command'
    ? `Command: ${r(item.target)}`
    : files.map(({ file, diff, contents }) => [
      `File: ${r(file)}`,
      diff ? `Diff (what the agent wanted to change):\n${r(diff)}` : 'Diff: (not available)',
      contents ? `${item.tier === 'allow' ? 'File after the edit' : 'File before the edit'}:\n${r(contents)}` : '',
    ].filter(Boolean).join('\n\n')).join('\n\n');

  return `You are a code review assistant. ClineShield, a safety layer for an AI coding agent, ${VERB[item.tier]} this ${item.kind}.
Rules engine score: ${score}${cutoffs}. Categories:
${reasons}${pending}

${subject}

In 2-3 sentences, explain to the developer what this ${item.kind} would actually do and why it is risky or not. Focus on the concrete behaviour; do not restate the categories or give a score.

Respond with JSON only, no markdown fences:
{ "explanation": "..." }`;
}

/** Workspace-relative, non-secrets path inside root, else undefined. */
function readablePath(root: string, file: string | undefined): string | undefined {
  if (!file || path.isAbsolute(file) || isSecretsFile(file)) return undefined;
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? abs : undefined;
}

export function createExplainer(deps: ExplainDeps): (item: ActionItem) => Promise<GeminiResult> {
  const caller = deps.caller ?? callGemini;
  const readFile = deps.readFile ?? ((abs: string) => fs.readFile(abs, 'utf-8'));
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(res => setTimeout(res, ms)));
  let last = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();

  /** Every file of an edit; MAX_FILE_CHARS of contents is shared evenly between them. */
  async function gather(item: ActionItem): Promise<ExplainFile[]> {
    if (item.kind !== 'edit' || item.files.length === 0) return [];
    const { entries } = await readSidecar(deps.root);
    const cap = Math.floor(MAX_FILE_CHARS / item.files.length);
    return Promise.all(item.files.map(async file => {
      const diff = entries.find(e => e.sessionId === item.sessionId && e.timestamp === item.timestamp && e.file === file)?.diff ?? '';
      const abs = readablePath(deps.root, file);
      let contents = abs ? await readFile(abs).catch(() => '') : '';
      if (contents.length > cap) contents = contents.slice(0, cap) + TRUNCATED;
      return { file, diff, contents };
    }));
  }

  async function run(item: ActionItem): Promise<GeminiResult> {
    try {
      const key = await deps.getKey();
      if (!key) return { ok: false, error: 'no-key' };
      const files = await gather(item);
      const wait = GEMINI_MIN_INTERVAL_MS - (now() - last);
      if (wait > 0) await sleep(wait);
      last = now();
      return await caller(key, buildExplainPrompt(item, files));
    } catch {
      return { ok: false, error: 'explanation failed' };
    }
  }

  return item => {
    const result = queue.then(() => run(item));
    queue = result.catch(() => undefined);
    return result;
  };
}
