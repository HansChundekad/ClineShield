import { aggregateFileStats } from '../aggregate';

const ev = (type: string, data: Record<string, unknown>, s = 0, sid = 's1') =>
  ({ timestamp: new Date(Date.UTC(2026, 10, 10, 10, 0, s)).toISOString(), sessionId: sid, type, data });
const edit = { structuralChangePercent: 1, functionsDeleted: 0, exportsDeleted: 0 };

describe('aggregateFileStats', () => {
  it('a blocked attempt alone marks the file high and blocked', () => {
    const m = aggregateFileStats([ev('edit-blocked', { file: 'a.ts', reason: 'r', ...edit, score: 80 })]);
    expect(m.get('a.ts')).toEqual({ editCount: 1, worstLevel: 'high', blocked: true });
  });

  it('a 1.x blocked event without score is still high and blocked', () => {
    const m = aggregateFileStats([ev('edit-blocked', { file: 'old.ts', reason: 'r', ...edit })]);
    expect(m.get('old.ts')).toEqual({ editCount: 1, worstLevel: 'high', blocked: true });
  });

  it('a refused then approved ask is medium even if the after-edit score is low, counted once', () => {
    const m = aggregateFileStats([
      ev('edit-approval', { file: 'a.ts', reason: 'r', approved: false, ...edit }, 0),
      ev('edit-approval', { file: 'a.ts', reason: 'r', approved: true, ...edit }, 9),
      ev('risk-assessed', { file: 'a.ts', rulesScore: 10, level: 'low', reasons: [] }, 9),
    ]);
    expect(m.get('a.ts')).toEqual({ editCount: 1, worstLevel: 'medium', blocked: false });
  });

  it('two refusals in a row count as one ask', () => {
    const m = aggregateFileStats([
      ev('edit-approval', { file: 'a.ts', reason: 'r', approved: false, ...edit }, 0),
      ev('edit-approval', { file: 'a.ts', reason: 'r', approved: false, ...edit }, 5),
    ]);
    expect(m.get('a.ts')?.editCount).toBe(1);
  });

  it('allowed edits take the risk-assessed level; markers and commands are ignored', () => {
    const m = aggregateFileStats([
      ev('edit-allowed', { file: 'session-start', ...edit }),
      ev('edit-allowed', { file: 'b.ts', ...edit }),
      ev('risk-assessed', { file: 'b.ts', rulesScore: 0, level: 'low', reasons: [] }),
      ev('command-assessed', { command: 'rm x', tier: 'block', score: 80, reasons: [] }),
    ]);
    expect([...m.keys()]).toEqual(['b.ts']);
    expect(m.get('b.ts')).toEqual({ editCount: 1, worstLevel: 'low', blocked: false });
  });

  it.each([[undefined], [null], [{}], [[null, { type: 'edit-blocked' }, { type: 'edit-blocked', data: null }]]])('malformed %p → empty map', input => {
    expect(aggregateFileStats(input).size).toBe(0);
  });
});
