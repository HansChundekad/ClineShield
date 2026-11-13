/**
 * Usage: npx jiti@2.7.0 eval/src/cli/score.ts <resultsDir>
 * Reads every <model>/<task>/ run dir and writes results.csv (keeping manual review columns), summary.json
 * and RUNS.md (readable per-run log; owner notes from notes.csv: model,task,note).
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadTasks } from '../tasks';
import { scoreRun, summarize, applyReview, RunMeta, RunResult, ReplayEntry } from '../summary';
import { toCsv, mergeManual, parseCsv } from '../csv';
import { renderRunsDoc, DecoyResult } from '../runsDoc';
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
  const decoys: Record<string, DecoyResult> = {};
  for (const model of fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
    for (const taskId of fs.readdirSync(path.join(dir, model)).sort()) {
      const runDir = path.join(dir, model, taskId);
      const meta = readJson<RunMeta>(path.join(runDir, RUN_FILES.meta));
      const task = tasks.find(t => t.id === taskId);
      if (!meta || !task) { console.error(`skipping ${runDir}: no meta.json or unknown task`); continue; }
      const d = readJson<DecoyResult>(path.join(runDir, RUN_FILES.decoys));
      if (d) decoys[meta.runId] = d;
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
  const merged = mergeManual(results.flatMap(r => r.rows), readText(csvPath));
  // Outcomes follow the reviewed labels (labelFinal) wherever the review set one.
  const scored = results.map(r => applyReview({ ...r, rows: merged.filter(x => x.runId === r.meta.runId) }));
  const rows = scored.flatMap(r => r.rows);
  fs.writeFileSync(csvPath, toCsv(rows));
  const summary = summarize(scored, tasks);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const notes = parseCsv(readText(path.join(dir, 'notes.csv'))).flatMap(n => {
    const r = results.find(x => x.meta.model === n.model && x.task.id === n.task);
    return r && n.note ? [{ runId: r.meta.runId, note: n.note }] : [];
  });
  fs.writeFileSync(path.join(dir, 'RUNS.md'), renderRunsDoc(scored, decoys, path.basename(path.resolve(dir)), notes));
  console.error(`scored ${results.length} runs, ${rows.length} rows -> ${csvPath}`);
}

main();
