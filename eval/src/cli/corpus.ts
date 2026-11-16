/**
 * Inside the container. From the host: npx jiti@2.7.0 eval/src/cli/in-docker.ts eval/results/corpus-<date> corpus.ts
 * Scores every entry of eval/corpus/actions.json at the three presets (nothing is executed) and writes corpus.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import { prepareWorkspace } from '../workspace';
import { replayCall, Preset } from '../replay';
import { CONTAINER, EVAL_DIR } from '../paths';
import type { SetupStep, Task, Tier } from '../types';

interface Entry { id: string; category: string; label: string; tool: string; input: unknown; setup: SetupStep[]; expected: Record<Preset, Tier>; note: string }
const PRESETS: Preset[] = ['relaxed', 'balanced', 'strict'];

async function main(): Promise<void> {
  const entries = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'corpus', 'actions.json'), 'utf-8')) as Entry[];
  const out: unknown[] = [];
  const quiet = console.error;
  for (const e of entries) {
    const task = { id: e.id, label: 'safe', prompt: '-', setup: e.setup, destructive: [], expected: ['allow'], categories: [], opus: false } as Task;
    await prepareWorkspace(task, { fixture: CONTAINER.fixture, work: CONTAINER.work, remote: CONTAINER.remote, targets: CONTAINER.targets, guards: CONTAINER.guards });
    const actual = {} as Record<Preset, Tier>;
    const ms = {} as Record<Preset, number>;
    console.error = () => {};
    for (const p of PRESETS) {
      const r = await replayCall({ runId: 'corpus', toolCallId: e.id, name: e.tool, input: e.input, result: '', isError: false, ts: 0, order: 0 }, CONTAINER.work, p);
      actual[p] = r.tier;
      ms[p] = r.ms;
    }
    const metrics = (() => { try { return JSON.parse(fs.readFileSync(path.join(CONTAINER.work, '.cline-shield', 'metrics.json'), 'utf-8')); } catch { return []; } })();
    console.error = quiet;
    const matches = PRESETS.every(p => actual[p] === e.expected[p]);
    out.push({ id: e.id, category: e.category, label: e.label, expected: e.expected, actual, matches, ms, note: e.note, events: metrics.slice(-6) });
    console.error(`[corpus] ${e.id} ${e.category}: ${PRESETS.map(p => actual[p]).join('/')} ${matches ? 'ok' : `EXPECTED ${PRESETS.map(p => e.expected[p]).join('/')}`}`);
  }
  const caughtAtBalanced = (out as { label: string; actual: Record<Preset, Tier> }[]).filter(x => x.label === 'destructive');
  const summary = {
    entries: out.length,
    matches: (out as { matches: boolean }[]).filter(x => x.matches).length,
    destructive: { total: caughtAtBalanced.length, caught: Object.fromEntries(PRESETS.map(p => [p, caughtAtBalanced.filter(x => x.actual[p] !== 'allow').length])) },
    safe: Object.fromEntries(PRESETS.map(p => [p, (out as { label: string; actual: Record<Preset, Tier> }[]).filter(x => x.label === 'safe' && x.actual[p] !== 'allow').length])),
  };
  fs.writeFileSync(path.join(CONTAINER.results, 'corpus.json'), JSON.stringify({ summary, entries: out }, null, 2));
  console.error(`[corpus] ${summary.matches}/${summary.entries} match the hand-computed expectation`);
}

main().catch(e => { console.error(e); process.exit(1); });
