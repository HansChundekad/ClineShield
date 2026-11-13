/**
 * Runs ONE task inside the eval container. Usage (from run.ts via docker):
 *   jiti /opt/clineshield/eval/src/cli/in-container.ts <taskId> <modelKey> <modelId> <runId>
 * Writes everything into /results/<modelKey>/<taskId>/, each text file redacted.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { loadTasks } from '../tasks';
import { prepareWorkspace, checkDecoys, WorkspaceDirs } from '../workspace';
import { clineArgs, parseRunOutput } from '../runner';
import { redact } from '../redact';
import { CONTAINER, RUN_FILES, TASKS_FILE } from '../paths';
import type { ModelKey } from '../types';

const HARD_KILL_MS = 660_000;
const SESSIONS = path.join(os.homedir(), '.cline', 'data', 'sessions');
const LOGS = path.join(os.homedir(), '.cline', 'data', 'logs');

const listDir = (d: string): string[] => { try { return fs.readdirSync(d); } catch { return []; } };
const readText = (f: string): string | null => { try { return fs.readFileSync(f, 'utf-8'); } catch { return null; } };

async function main(): Promise<void> {
  const [taskId, model, modelId, runId] = process.argv.slice(2) as [string, ModelKey, string, string];
  const tasks = loadTasks(TASKS_FILE);
  const task = tasks.find(t => t.id === taskId);
  if (!task || !model || !modelId || !runId) throw new Error('usage: in-container.ts <taskId> <modelKey> <modelId> <runId>');
  const allow = [...task.prompt.matchAll(/sk_live_\w+/g)].map(m => m[0]);
  const out = path.join(CONTAINER.results, model, taskId);
  fs.mkdirSync(out, { recursive: true });
  const write = (name: string, text: string | null) => { if (text !== null) fs.writeFileSync(path.join(out, name), redact(text, allow).text); };

  const dirs: WorkspaceDirs = { fixture: CONTAINER.fixture, work: CONTAINER.work, remote: CONTAINER.remote, targets: CONTAINER.targets, guards: CONTAINER.guards, nodeModules: CONTAINER.nodeModules };
  await prepareWorkspace(task, dirs);
  execFileSync('cline', ['plugin', 'install', '--force', '/opt/clineshield'], { stdio: 'ignore' });

  const sessionsBefore = new Set(listDir(SESSIONS));
  const logsBefore = new Map(listDir(LOGS).map(f => [f, fs.statSync(path.join(LOGS, f)).size]));
  const started = Date.now();
  const { code, stdout, stderr, killed } = await new Promise<{ code: number | null; stdout: string; stderr: string; killed: boolean }>(resolve => {
    const child = spawn('cline', clineArgs(task, modelId), { cwd: CONTAINER.work, env: { ...process.env, CLINESHIELD_EVAL_TIMING: '1' } });
    let so = '';
    let se = '';
    let k = false;
    const timer = setTimeout(() => { k = true; child.kill('SIGKILL'); }, HARD_KILL_MS);
    child.stdout.on('data', d => (so += d));
    child.stderr.on('data', d => (se += d));
    child.on('close', c => { clearTimeout(timer); resolve({ code: c, stdout: so, stderr: se, killed: k }); });
  });
  const durationMs = Date.now() - started;

  const parsed = parseRunOutput(stdout);
  const newSessions = listDir(SESSIONS).filter(s => !sessionsBefore.has(s));
  const sessionId = parsed.sessionId && listDir(SESSIONS).includes(parsed.sessionId) ? parsed.sessionId : newSessions.sort().pop() ?? null;
  let session: { status?: string; metadata?: { totalCost?: number } } | null = null;
  if (sessionId) {
    const sdir = path.join(SESSIONS, sessionId);
    const sjson = readText(path.join(sdir, `${sessionId}.json`));
    write(RUN_FILES.session, sjson);
    write(RUN_FILES.messages, readText(path.join(sdir, `${sessionId}.messages.json`)));
    try { session = JSON.parse(sjson ?? 'null'); } catch { session = null; }
  }
  // Plugin lines from Cline's own logs (only lines the plugin printed), for the timing check.
  const pluginLines: string[] = [];
  for (const f of listDir(LOGS)) {
    const text = readText(path.join(LOGS, f));
    if (text === null) continue;
    const fresh = text.slice(logsBefore.get(f) ?? 0);
    pluginLines.push(...fresh.split('\n').filter(l => l.includes('[ClineShield]')));
  }

  write(RUN_FILES.stdout, stdout);
  write(RUN_FILES.stderr, [stderr, ...pluginLines].join('\n'));
  write(RUN_FILES.metrics, readText(path.join(CONTAINER.work, '.cline-shield', 'metrics.json')));
  write(RUN_FILES.answers, readText(path.join(CONTAINER.work, '.cline-shield', 'answers.json')));
  const git = (...a: string[]) => { try { return execFileSync('git', a, { cwd: CONTAINER.work, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }); } catch (e) { return `git ${a.join(' ')} failed: ${(e as Error).message}`; } };
  write(RUN_FILES.gitStatus, git('status', '--porcelain'));
  write(RUN_FILES.gitDiff, git('diff', 'HEAD'));
  const decoys = await checkDecoys(dirs);
  write(RUN_FILES.decoys, JSON.stringify(decoys, null, 2));

  const error = killed ? 'killed after hard timeout' : !sessionId ? 'no session record' : undefined;
  const meta = {
    runId: `${runId}/${model}/${taskId}`, model, modelId, task: taskId, exitCode: code,
    finishReason: killed ? 'killed' : parsed.finishReason ?? session?.status ?? 'unknown', durationMs,
    cost: typeof session?.metadata?.totalCost === 'number' ? session.metadata.totalCost : null,
    ...(error ? { error } : {}),
    sessionId, clineVersion: execFileSync('cline', ['--version'], { encoding: 'utf-8' }).trim(),
    pluginSha: (readText('/opt/clineshield/eval/BUILD_SHA') ?? 'unknown').trim(),
  };
  write(RUN_FILES.meta, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ task: taskId, model, cost: meta.cost, decoysOk: decoys.ok, finishReason: meta.finishReason }));
}

main().catch(e => { console.error(`[eval] in-container failed: ${(e as Error).stack ?? e}`); process.exit(1); });
