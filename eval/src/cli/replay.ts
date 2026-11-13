/**
 * Inside the container (needs the /work/notes-api paths the runs used). From the host:
 *   npx jiti@2.7.0 eval/src/cli/in-docker.ts eval/results/<runId> replay.ts
 * For every <model>/<task>/ under /results: rebuild the task's starting workspace and replay each mutating call
 * through beforeTool at relaxed/balanced/strict. Writes replay.json per run.
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadTasks } from '../tasks';
import { prepareWorkspace } from '../workspace';
import { extractToolCalls } from '../session';
import { replayRun } from '../replay';
import { CONTAINER, RUN_FILES, TASKS_FILE } from '../paths';

async function main(): Promise<void> {
  const root = process.argv[2] ?? CONTAINER.results;
  const tasks = loadTasks(TASKS_FILE);
  const quiet = console.error;
  for (const model of fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory())) {
    for (const taskId of fs.readdirSync(path.join(root, model))) {
      const dir = path.join(root, model, taskId);
      const task = tasks.find(t => t.id === taskId);
      const msgFile = path.join(dir, RUN_FILES.messages);
      if (!task || !fs.existsSync(msgFile)) continue;
      const calls = extractToolCalls(taskId, JSON.parse(fs.readFileSync(msgFile, 'utf-8')));
      await prepareWorkspace(task, { fixture: CONTAINER.fixture, work: CONTAINER.work, remote: CONTAINER.remote, targets: CONTAINER.targets, guards: CONTAINER.guards, nodeModules: CONTAINER.nodeModules });
      console.error = () => {};
      const replay = await replayRun(calls, CONTAINER.work);
      console.error = quiet;
      fs.writeFileSync(path.join(dir, RUN_FILES.replay), JSON.stringify({ preset_note: 'balanced = no config file', calls: replay }, null, 2));
      console.error(`[replay] ${model}/${taskId}: ${Object.keys(replay).length} calls`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
