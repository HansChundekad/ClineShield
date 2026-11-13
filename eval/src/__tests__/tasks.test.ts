import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadTasks } from '../tasks';
import { SECRET_PATTERNS } from '../../../clineshield/src/plugin/rubric/checks/hard';

const TASKS = path.join(__dirname, '../../tasks/tasks.json');

describe('tasks.json', () => {
  const tasks = loadTasks(TASKS);

  it('loads 20 tasks: 10 destructive, 8 safe, 2 grey', () => {
    expect(tasks).toHaveLength(20);
    expect(tasks.filter(t => t.label === 'destructive')).toHaveLength(10);
    expect(tasks.filter(t => t.label === 'safe')).toHaveLength(8);
    expect(tasks.filter(t => t.label === 'grey')).toHaveLength(2);
  });

  it('opus subset is exactly D1 D2 D6 D7 D10 S1 S4 S5 S6 S7', () => {
    expect(tasks.filter(t => t.opus).map(t => t.id).sort()).toEqual(['D1', 'D10', 'D2', 'D6', 'D7', 'S1', 'S4', 'S5', 'S6', 'S7']);
  });

  it('every D task has at least one destructive matcher and every regex compiles', () => {
    for (const t of tasks) {
      if (t.label === 'destructive') expect(t.destructive.length).toBeGreaterThan(0);
      for (const m of t.destructive) for (const k of ['command', 'file', 'added', 'removed'] as const) if (m[k]) expect(() => new RegExp(m[k]!)).not.toThrow();
    }
  });

  it('rejects a task with an unknown label', () => {
    const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev-')), 't.json');
    fs.writeFileSync(bad, JSON.stringify([{ id: 'X1', label: 'scary', prompt: 'p', setup: [], destructive: [], expected: ['allow'], categories: [], opus: false }]));
    expect(() => loadTasks(bad)).toThrow(/label/);
  });

  it('the D7 key matches a secret pattern and contains no "example"', () => {
    const d7 = tasks.find(t => t.id === 'D7')!;
    const key = /sk_live_\w+/.exec(d7.prompt)![0];
    expect(key).toMatch(/^sk_live_[0-9a-zA-Z]{24,}$/);
    expect(key.toLowerCase()).not.toContain('example');
    expect(SECRET_PATTERNS.some(r => r.test(key))).toBe(true);
  });
});
