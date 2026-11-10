import { RECENT_LIMIT, buildDashboard } from '../dashboard';

const T0 = Date.parse('2026-11-10T10:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const ids = (...s: string[]) => new Set(s.length ? s : ['s1']);
const none = new Set<string>();

const marker = (sid = 's1', s = 0) => ({ timestamp: at(s), sessionId: sid, type: 'edit-allowed', data: { file: 'session-start', structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0 } });
const allowed = (file: string, s: number, sid = 's1') => ({ timestamp: at(s), sessionId: sid, type: 'edit-allowed', data: { file, structuralChangePercent: 1, functionsDeleted: 0, exportsDeleted: 0 } });
const risk = (file: string, s: number, score: number, sid = 's1') => ({ timestamp: at(s), sessionId: sid, type: 'risk-assessed', data: { file, rulesScore: score, level: 'low', reasons: [{ rule: 'manifest', points: score, description: 'Dependency manifest changed' }] } });
const reasons = [{ rule: 'rewrite_share', points: 45, description: 'Rewrites 95% of the file' }];
const cutoffs = { ask: 40, block: 70 };
const approval = (file: string, s: number, approved: boolean, sid = 's1') => ({ timestamp: at(s), sessionId: sid, type: 'edit-approval', data: { file, structuralChangePercent: 95, functionsDeleted: 0, exportsDeleted: 0, reason: 'needs approval', approved, score: 45, reasons, cutoffs } });
const blocked = (file: string, s: number, extra: Record<string, unknown> = { score: 80, reasons, cutoffs }, sid = 's1') => ({ timestamp: at(s), sessionId: sid, type: 'edit-blocked', data: { file, reason: 'ClineShield blocked this action', structuralChangePercent: 99, functionsDeleted: 4, exportsDeleted: 0, ...extra } });
const command = (cmd: string, s: number, tier: string, extra: Record<string, unknown> = {}, sid = 's1') => ({ timestamp: at(s), sessionId: sid, type: 'command-assessed', data: { command: cmd, tier, score: 75, reasons: [{ rule: 'rm_outside', points: 75, description: 'Deletes outside the workspace' }], cutoffs, ...extra } });

describe('buildDashboard', () => {
  it.each([[undefined], [null], [{}], [[null, { type: 'x' }, { sessionId: 's1', type: 'edit-blocked' }]]])('malformed input %p → empty dashboard', input => {
    const d = buildDashboard(input, ids(), none);
    expect(d).toEqual({
      waiting: [], recent: [], hasEvents: false,
      totals: { edits: { allowed: 0, asked: 0, approved: 0, blocked: 0 }, commands: { asked: 0, approved: 0, blocked: 0 } },
    });
  });

  it('session-start markers alone are not activity', () => {
    expect(buildDashboard([marker()], ids(), none).hasEvents).toBe(false);
  });

  it('a refused ask then its approval is one asked item, approved, counted once, not waiting', () => {
    const d = buildDashboard([approval('a.ts', 0, false), approval('a.ts', 20, true)], ids(), none);
    expect(d.recent).toHaveLength(1);
    expect(d.recent[0]).toMatchObject({ kind: 'edit', tier: 'ask', approved: true, target: 'a.ts', score: 45, reasons, cutoffs });
    expect(d.totals.edits).toMatchObject({ asked: 1, approved: 1 });
    expect(d.waiting).toEqual([]);
  });

  it('the same action refused twice without approval is one ask, keyed to the latest refusal', () => {
    const d = buildDashboard([approval('a.ts', 0, false), approval('a.ts', 5, false)], ids(), none);
    expect(d.recent).toHaveLength(1);
    expect(d.recent[0].timestamp).toBe(at(5));
    expect(d.totals.edits.asked).toBe(1);
  });

  it('a batched action within 15 s keeps an ask waiting; one 15 s or later clears it', () => {
    const batch = buildDashboard([approval('a.ts', 0, false), allowed('b.ts', 3)], ids(), none);
    expect(batch.waiting.map(i => i.target)).toEqual(['a.ts']);
    const later = buildDashboard([approval('a.ts', 0, false), allowed('b.ts', 16)], ids(), none);
    expect(later.waiting).toEqual([]);
  });

  it('a newer block replaces an older ask in the same session', () => {
    const d = buildDashboard([approval('a.ts', 0, false), blocked('b.ts', 2)], ids(), none);
    expect(d.waiting.map(i => [i.tier, i.target])).toEqual([['block', 'b.ts']]);
  });

  it('a dismissed item stops waiting but stays in recent', () => {
    const first = buildDashboard([blocked('b.ts', 0)], ids(), none);
    const d = buildDashboard([blocked('b.ts', 0)], ids(), new Set([first.waiting[0].id]));
    expect(d.waiting).toEqual([]);
    expect(d.recent).toHaveLength(1);
  });

  it('parallel sessions with the same timestamp keep separate items', () => {
    const d = buildDashboard([approval('a.ts', 0, false, 's1'), approval('a.ts', 0, false, 's2')], ids('s1', 's2'), none);
    expect(d.waiting).toHaveLength(2);
    expect(new Set(d.waiting.map(i => i.id)).size).toBe(2);
  });

  it('a blocked command carries its categories, score and cut-offs', () => {
    const [item] = buildDashboard([command('rm -rf ../x', 0, 'block')], ids(), none).recent;
    expect(item).toMatchObject({ kind: 'command', tier: 'block', target: 'rm -rf ../x', score: 75, cutoffs, files: [] });
    expect(item.reasons).toEqual([{ rule: 'rm_outside', points: 75, description: 'Deletes outside the workspace' }]);
  });

  it('an approved command ask marks the earlier refusal approved', () => {
    const d = buildDashboard([command('sudo x', 0, 'ask', { approved: false }), command('sudo x', 30, 'ask', { approved: true })], ids(), none);
    expect(d.recent).toHaveLength(1);
    expect(d.recent[0]).toMatchObject({ tier: 'ask', approved: true });
    expect(d.totals.commands).toEqual({ asked: 1, approved: 1, blocked: 0 });
  });

  it('a 1.x blocked edit without score keeps its reason text', () => {
    const [item] = buildDashboard([blocked('old.ts', 0, {})], ids(), none).recent;
    expect(item).toMatchObject({ score: null, reasons: null, cutoffs: null, reasonText: 'ClineShield blocked this action' });
  });

  it('an allowed edit takes its score from the following risk-assessed', () => {
    const [item] = buildDashboard([allowed('package.json', 0), risk('package.json', 1, 30)], ids(), none).recent;
    expect(item).toMatchObject({ tier: 'allow', score: 30 });
    expect(item.reasons).toEqual([{ rule: 'manifest', points: 30, description: 'Dependency manifest changed' }]);
  });

  it('a multi-file blocked edit is one item with every file and the highest score', () => {
    const d = buildDashboard([blocked('a.ts', 0, { score: 50 }), blocked('b.ts', 0, { score: 80 })], ids(), none);
    expect(d.recent).toHaveLength(1);
    expect(d.recent[0]).toMatchObject({ files: ['a.ts', 'b.ts'], target: 'a.ts, b.ts', score: 80 });
    expect(d.totals.edits.blocked).toBe(1);
  });

  it('recent keeps the newest 15, newest first', () => {
    const evs = Array.from({ length: 20 }, (_, i) => allowed(`f${i}.ts`, i));
    const d = buildDashboard(evs, ids(), none);
    expect(d.recent).toHaveLength(RECENT_LIMIT);
    expect(d.recent[0].target).toBe('f19.ts');
    expect(d.totals.edits.allowed).toBe(20);
  });

  it('keeps log text verbatim (escaping happens in the DOM)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    expect(buildDashboard([command(evil, 0, 'block')], ids(), none).recent[0].target).toBe(evil);
  });

  it('ignores sessions that are not visible', () => {
    const d = buildDashboard([blocked('a.ts', 0, undefined, 'other')], ids('s1'), none);
    expect(d).toMatchObject({ recent: [], waiting: [], hasEvents: false });
  });
});
