/**
 * sidecar.ts
 *
 * The diff sidecar: <root>/.cline-shield/diff-context.json holds the newest
 * edit diffs so the VS Code extension can explain an action on click (SPEC.md
 * "VS Code extension"). Entries are keyed by the logged event's sessionId +
 * timestamp + file. Not a metrics.json event. Diffs are secret-redacted and
 * capped; secrets files get no entry. Best effort: never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { FileOperation } from './patch';
import { redactSecrets } from './rubric/redact';
import { isSecretsFile } from './rubric/paths';

export const SIDECAR_FILE = 'diff-context.json';
export const MAX_SIDECAR_ENTRIES = 50;
export const MAX_SIDECAR_DIFF = 4000;
const TRUNCATED = '\n... [truncated]';
const PREFIX = { context: ' ', remove: '-', add: '+' } as const;

export interface SidecarEntry { sessionId: string; timestamp: string; file: string; diff: string }
export interface Sidecar { entries: SidecarEntry[] }

const sidecarPath = (root: string) => path.join(root, '.cline-shield', SIDECAR_FILE);

export function diffTextFor(op: FileOperation): string {
  if (op.type === 'delete') return '(file deleted)';
  if (op.type === 'add') return op.lines.map(l => `+${l}`).join('\n');
  return op.hunks.flatMap(h => h.lines.map(l => `${PREFIX[l.kind]}${l.text}`)).join('\n');
}

export function sidecarEntry(sessionId: string, timestamp: string, file: string, op: FileOperation): SidecarEntry | undefined {
  if (isSecretsFile(file)) return undefined;
  let diff = redactSecrets(diffTextFor(op));
  if (diff.length > MAX_SIDECAR_DIFF) diff = diff.slice(0, MAX_SIDECAR_DIFF) + TRUNCATED;
  return { sessionId, timestamp, file, diff };
}

const isEntry = (e: unknown): e is SidecarEntry => {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  return typeof x.sessionId === 'string' && typeof x.timestamp === 'string' && typeof x.file === 'string' && typeof x.diff === 'string';
};

export async function readSidecar(root: string): Promise<Sidecar> {
  try {
    const parsed = JSON.parse(await fs.readFile(sidecarPath(root), 'utf-8')) as { entries?: unknown };
    return { entries: Array.isArray(parsed?.entries) ? parsed.entries.filter(isEntry) : [] };
  } catch {
    return { entries: [] };
  }
}

/** Appends run one at a time per process, so concurrent decisions don't overwrite each other's entries. */
let queue: Promise<void> = Promise.resolve();

export function appendSidecar(root: string, entries: SidecarEntry[]): Promise<void> {
  const next = queue.then(() => appendNow(root, entries));
  queue = next;
  return next;
}

async function appendNow(root: string, entries: SidecarEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const target = sidecarPath(root);
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const existing = (await readSidecar(root)).entries;
    const next: Sidecar = { entries: [...existing, ...entries].slice(-MAX_SIDECAR_ENTRIES) };
    await fs.writeFile(temp, JSON.stringify(next), 'utf-8');
    await fs.rename(temp, target);
  } catch (error) {
    console.error('[ClineShield] diff sidecar not written:', (error as Error)?.message ?? error);
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}
