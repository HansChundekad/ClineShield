/** Run planning, the budget loop and Cline output parsing (design §7.2, §7.3). */
import { CONTAINER } from './paths';
import type { ModelKey, Task } from './types';

export interface PlannedRun { model: ModelKey; modelId: string; task: Task }
const MODEL_ORDER: ModelKey[] = ['sonnet', 'gpt', 'opus'];

/** sonnet and gpt run every task; opus runs only tasks with opus: true. Model by model, tasks in file order. */
export function planRuns(tasks: Task[], models: Record<ModelKey, string>, only: { tasks?: string[]; models?: ModelKey[] } = {}): PlannedRun[] {
  for (const id of only.tasks ?? []) if (!tasks.some(t => t.id === id)) throw new Error(`unknown task ${id}`);
  const plan: PlannedRun[] = [];
  for (const model of MODEL_ORDER) {
    if (only.models && !only.models.includes(model)) continue;
    for (const task of tasks) {
      if (only.tasks && !only.tasks.includes(task.id)) continue;
      if (model === 'opus' && !task.opus) continue;
      plan.push({ model, modelId: models[model], task });
    }
  }
  return plan;
}

/** One-shot, auto-approve on so ClineShield is the only gate; Cline's default --retries 3; 600 s timeout. */
export function clineArgs(task: Task, modelId: string): string[] {
  return ['--json', '--auto-approve', 'true', '-m', modelId, '--retries', '3', '-t', '600', '-c', CONTAINER.work, task.prompt];
}

export interface ExecuteDeps {
  cap: number;
  runOne: (run: PlannedRun) => Promise<{ cost: number | null; decoysOk: boolean }>;
  log?: (line: string) => void;
}

/** Runs the plan one at a time. Stops before a run when total + the largest run cost so far would pass the cap, or after a failed decoy check. */
export async function executePlan(plan: PlannedRun[], deps: ExecuteDeps): Promise<{ completed: number; total: number; stopped: string | null }> {
  let total = 0;
  let maxCost = 0;
  let completed = 0;
  for (const run of plan) {
    if (completed > 0 && total + maxCost > deps.cap) {
      return { completed, total, stopped: `cap: spent ${total.toFixed(4)}, next run could pass ${deps.cap}` };
    }
    const r = await deps.runOne(run);
    const cost = r.cost ?? maxCost;
    total += cost;
    maxCost = Math.max(maxCost, cost);
    completed++;
    deps.log?.(`${run.model}/${run.task.id}: cost ${r.cost ?? 'unknown'}, total ${total.toFixed(4)}`);
    if (!r.decoysOk) return { completed, total, stopped: `decoy check failed after ${run.model}/${run.task.id}` };
  }
  return { completed, total, stopped: null };
}

function findKey(v: unknown, keys: string[], depth = 0): string | null {
  if (!v || typeof v !== 'object' || depth > 6) return null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (keys.includes(k) && typeof x === 'string' && x) return x;
  }
  for (const x of Object.values(v as Record<string, unknown>)) {
    const f = findKey(x, keys, depth + 1);
    if (f) return f;
  }
  return null;
}

/** Session id and finish reason from `cline --json` stdout (format not documented: searched for the keys anywhere). Last finish reason wins. */
export function parseRunOutput(stdout: string): { sessionId: string | null; finishReason: string | null } {
  let sessionId: string | null = null;
  let finishReason: string | null = null;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj: unknown;
    try { obj = JSON.parse(t); } catch { continue; }
    sessionId ??= findKey(obj, ['sessionId', 'session_id']);
    finishReason = findKey(obj, ['finishReason', 'finish_reason']) ?? finishReason;
  }
  return { sessionId, finishReason };
}
