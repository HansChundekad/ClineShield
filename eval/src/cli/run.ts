/**
 * Host side. Usage: npx jiti@2.7.0 eval/src/cli/run.ts <runId> --cap <usd> [--tasks D1,S1] [--models sonnet,codex]
 * Needs eval/models.json ({ sonnet, opus, codex } -> Cline model ids) and the image clineshield-eval:<HEAD short sha>.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { loadTasks } from '../tasks';
import { planRuns, executePlan, PlannedRun } from '../runner';
import { dockerRunArgs } from '../docker';
import { EVAL_DIR, RUN_FILES, TASKS_FILE } from '../paths';
import type { ModelKey } from '../types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const runId = process.argv[2];
  const cap = Number(arg('cap'));
  if (!runId || runId.startsWith('--') || !Number.isFinite(cap) || cap <= 0) throw new Error('usage: run.ts <runId> --cap <usd> [--tasks ..] [--models ..]');
  const models = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'models.json'), 'utf-8')) as Record<ModelKey, string>;
  const plan = planRuns(loadTasks(TASKS_FILE), models, { tasks: arg('tasks')?.split(','), models: arg('models')?.split(',') as ModelKey[] | undefined });
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
  const image = `clineshield-eval:${sha}`;
  execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
  const resultsDir = path.join(EVAL_DIR, 'results', runId);
  if (fs.existsSync(resultsDir)) throw new Error(`${resultsDir} exists: runs are never repeated silently; pick a new runId`);
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'plan.json'), JSON.stringify({ runId, image, cap, startedAt: new Date().toISOString(), runs: plan.map(p => `${p.model}/${p.task.id}`) }, null, 2));

  const runOne = (p: PlannedRun) => new Promise<{ cost: number | null; decoysOk: boolean }>(resolve => {
    const args = dockerRunArgs({ image, resultsDir, cmd: ['jiti', '/opt/clineshield/eval/src/cli/in-container.ts', p.task.id, p.model, p.modelId, runId] });
    const child = spawn('docker', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('close', () => {
      const dir = path.join(resultsDir, p.model, p.task.id);
      let cost: number | null = null;
      let decoysOk = false;
      try { cost = (JSON.parse(fs.readFileSync(path.join(dir, RUN_FILES.meta), 'utf-8')) as { cost: number | null }).cost; } catch { /* run failed before meta */ }
      try { decoysOk = (JSON.parse(fs.readFileSync(path.join(dir, RUN_FILES.decoys), 'utf-8')) as { ok: boolean }).ok; } catch { decoysOk = false; }
      resolve({ cost, decoysOk });
    });
  });

  const budget: string[] = [];
  const result = await executePlan(plan, { cap, runOne, log: l => { budget.push(l); console.error(`[eval] ${l}`); fs.writeFileSync(path.join(resultsDir, 'budget.json'), JSON.stringify({ cap, log: budget }, null, 2)); } });
  fs.writeFileSync(path.join(resultsDir, 'budget.json'), JSON.stringify({ cap, log: budget, ...result }, null, 2));
  console.error(`[eval] done: ${result.completed}/${plan.length} runs, spent ${result.total.toFixed(4)}${result.stopped ? `, STOPPED: ${result.stopped}` : ''}`);
}

main().catch(e => { console.error(`[eval] ${(e as Error).message}`); process.exit(1); });
