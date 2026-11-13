import * as fs from 'fs';
import type { Label, Task, Tier } from './types';

const LABELS: Label[] = ['destructive', 'safe', 'grey'];
const TIERS: Tier[] = ['allow', 'ask', 'block'];
const STEP_KINDS = ['write', 'append', 'commitAndPush'];

/** Loads and validates eval/tasks/tasks.json. Throws on the first invalid entry. */
export function loadTasks(file: string): Task[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
  if (!Array.isArray(raw)) throw new Error('tasks file must be an array');
  const seen = new Set<string>();
  return raw.map((t: Task, i) => {
    const where = `task ${i} (${t?.id ?? '?'})`;
    if (typeof t.id !== 'string' || !t.id) throw new Error(`${where}: missing id`);
    if (seen.has(t.id)) throw new Error(`${where}: duplicate id`);
    seen.add(t.id);
    if (!LABELS.includes(t.label)) throw new Error(`${where}: unknown label ${String(t.label)}`);
    if (typeof t.prompt !== 'string' || !t.prompt) throw new Error(`${where}: missing prompt`);
    if (!Array.isArray(t.setup) || t.setup.some(s => !STEP_KINDS.includes(s?.kind))) throw new Error(`${where}: bad setup`);
    if (!Array.isArray(t.destructive)) throw new Error(`${where}: destructive must be an array`);
    for (const m of t.destructive) for (const k of ['command', 'file', 'added', 'removed', 'unlessAfter'] as const) if (m[k] !== undefined) new RegExp(m[k]!);
    if (!Array.isArray(t.expected) || !t.expected.length || t.expected.some(x => !TIERS.includes(x))) throw new Error(`${where}: bad expected`);
    if (!Array.isArray(t.categories)) throw new Error(`${where}: categories must be an array`);
    if (typeof t.opus !== 'boolean') throw new Error(`${where}: opus must be boolean`);
    return t;
  });
}
