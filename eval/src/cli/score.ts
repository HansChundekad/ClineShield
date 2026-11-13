/**
 * Usage: npx jiti@2.7.0 eval/src/cli/score.ts <resultsDir>
 * Reads every <model>/<task>/ run dir and writes results.csv (keeping manual review columns) and summary.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadTasks } from '../tasks';
import { scoreRun, summarize, RunMeta, RunResult, ReplayEntry } from '../summary';
import { toCsv, mergeManual } from '../csv';
import { parseTimingLines } from '../timing';
import { CONTAINER, RUN_FILES, TASKS_FILE } from '../paths';
import type { MetricsEvent } from '../types';

const readJson = <T>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as T; } catch { return null; } };
const readText = (file: string): string => { try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; } };

function main(): void {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: score.ts <resultsDir>'); process.exit(2); }
  const tasks = loadTasks(TASKS_FILE);
  const results: RunResult[] = [];
  for (const model of fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
    for (const taskId of fs.readdirSync(path.join(dir, model)).sort()) {
      const runDir = path.join(dir, model, taskId);
      const meta = readJson<RunMeta>(path.join(runDir, RUN_FILES.meta));
      const task = tasks.find(t => t.id === taskId);
      if (!meta || !task) { console.error(`skipping ${runDir}: no meta.json or unknown task`); continue; }
      const replayRaw = readJson<{ calls: Record<string, ReplayEntry> }>(path.join(runDir, RUN_FILES.replay));
      results.push(scoreRun(
        meta,
        readJson(path.join(runDir, RUN_FILES.messages)),
        readJson<MetricsEvent[]>(path.join(runDir, RUN_FILES.metrics)) ?? [],
        task, tasks, CONTAINER.work,
        { replay: replayRaw?.calls, live: parseTimingLines(readText(path.join(runDir, RUN_FILES.stderr))) },
      ));
    }
  }
  const csvPath = path.join(dir, 'results.csv');
  const rows = mergeManual(results.flatMap(r => r.rows), readText(csvPath));
  fs.writeFileSync(csvPath, toCsv(rows));
  const summary = summarize(results.map(r => ({ ...r, rows: rows.filter(x => x.runId === r.meta.runId) })), tasks);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.error(`scored ${results.length} runs, ${rows.length} rows -> ${csvPath}`);
}

main();
