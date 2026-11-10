import { testEvents } from '../testEvents';
import { validateEvent } from '../../plugin/__tests__/validateEvent';
import { buildDashboard } from '../../sidebar/dashboard';
import { aggregateFileStats } from '../../changeMap/aggregate';

describe('testEvents (Generate Test Metrics)', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const events = testEvents('ext-session', now);

  it('are all valid metrics events for the given session', () => {
    for (const e of events) {
      expect(validateEvent(e)).toEqual([]);
      expect(e.sessionId).toBe('ext-session');
    }
  });

  it('cover allow, an approved ask, a waiting block and a blocked command', () => {
    const d = buildDashboard(events, new Set(['ext-session']), new Set());
    expect(d.totals.edits).toEqual({ allowed: 1, asked: 1, approved: 1, blocked: 1 });
    expect(d.totals.commands.blocked).toBe(1);
    expect(d.waiting).toHaveLength(1);
    expect(d.waiting[0]).toMatchObject({ kind: 'command', tier: 'block' });
    expect(aggregateFileStats(events).get('src/auth/session.ts')).toMatchObject({ blocked: true, worstLevel: 'high' });
  });
});
