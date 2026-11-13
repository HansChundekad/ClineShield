import * as path from 'path';
import { loadTasks } from '../tasks';
import { planRuns, clineArgs, executePlan, parseRunOutput, PlannedRun } from '../runner';

const tasks = loadTasks(path.join(__dirname, '../../tasks/tasks.json'));
const MODELS = { sonnet: 'anthropic/claude-sonnet-x', opus: 'anthropic/claude-opus-x', codex: 'openai/gpt-codex-x' };

describe('planRuns', () => {
  it('plans 50 runs: 20 sonnet, 20 codex, 10 opus', () => {
    const p = planRuns(tasks, MODELS);
    expect(p).toHaveLength(50);
    expect(p.filter(r => r.model === 'sonnet')).toHaveLength(20);
    expect(p.filter(r => r.model === 'codex')).toHaveLength(20);
    expect(p.filter(r => r.model === 'opus').map(r => r.task.id)).toEqual(['D1', 'D2', 'D6', 'D7', 'D10', 'S1', 'S4', 'S5', 'S6', 'S7']);
    expect(p[0]).toMatchObject({ model: 'sonnet', modelId: MODELS.sonnet });
  });

  it('filters by --tasks and --models', () => {
    const p = planRuns(tasks, MODELS, { tasks: ['D2', 'S5', 'D7'], models: ['sonnet'] });
    expect(p.map(r => `${r.model}/${r.task.id}`)).toEqual(['sonnet/D2', 'sonnet/D7', 'sonnet/S5']);
  });

  it('rejects an unknown task id', () => expect(() => planRuns(tasks, MODELS, { tasks: ['D99'] })).toThrow(/D99/));
});

describe('clineArgs', () => {
  it('builds the one-shot command in order', () => {
    const t = tasks.find(x => x.id === 'S1')!;
    expect(clineArgs(t, 'm-1')).toEqual(['--json', '--auto-approve', 'true', '-m', 'm-1', '--retries', '3', '-t', '600', '-c', '/work/notes-api', t.prompt]);
  });
});

describe('executePlan', () => {
  const plan: PlannedRun[] = planRuns(tasks, MODELS, { tasks: ['D1', 'D2', 'D3'], models: ['sonnet'] });

  it('runs everything under the cap', async () => {
    const r = await executePlan(plan, { cap: 10, runOne: async () => ({ cost: 1, decoysOk: true }) });
    expect(r).toMatchObject({ completed: 3, total: 3, stopped: null });
  });

  it('budget stops before a run that would pass the cap', async () => {
    const seen: string[] = [];
    const r = await executePlan(plan, { cap: 2.5, runOne: async p => { seen.push(p.task.id); return { cost: 1, decoysOk: true }; } });
    expect(seen).toEqual(['D1', 'D2']);
    expect(r.stopped).toMatch(/cap/);
    expect(r.total).toBe(2);
  });

  it('a failed decoy check stops the run', async () => {
    const seen: string[] = [];
    const r = await executePlan(plan, { cap: 100, runOne: async p => { seen.push(p.task.id); return { cost: 0.1, decoysOk: p.task.id !== 'D2' }; } });
    expect(seen).toEqual(['D1', 'D2']);
    expect(r.stopped).toMatch(/decoy.*D2/);
  });

  it('an unknown cost counts as the largest seen so far', async () => {
    const costs = [2, null, 0.5];
    let i = 0;
    const r = await executePlan(plan, { cap: 5, runOne: async () => ({ cost: costs[i++], decoysOk: true }) });
    expect(r.total).toBe(4);
    expect(r.stopped).toMatch(/cap/);
    expect(r.completed).toBe(2);
  });
});

describe('parseRunOutput', () => {
  it('finds the session id and finish reason anywhere in JSON lines', () => {
    const out = ['not json', JSON.stringify({ type: 'start', session: { sessionId: 's-123' } }), JSON.stringify({ type: 'done', result: { finishReason: 'completed' } })].join('\n');
    expect(parseRunOutput(out)).toEqual({ sessionId: 's-123', finishReason: 'completed' });
  });
  it('returns nulls when nothing is found', () => expect(parseRunOutput('')).toEqual({ sessionId: null, finishReason: null }));
});
