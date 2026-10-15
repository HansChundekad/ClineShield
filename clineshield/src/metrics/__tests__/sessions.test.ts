import {
  isSessionStartMarker,
  selectVisibleSessionIds,
  filterVisibleEvents,
} from '../sessions';
import type { MetricsEvent } from '../../types/metrics';

const EXT = 'ext-session';
const ACTIVATION = Date.parse('2026-10-14T10:00:00.000Z');

function start(sessionId: string, timestamp: string): MetricsEvent {
  return {
    timestamp,
    sessionId,
    type: 'edit-allowed',
    data: { file: 'session-start', structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0 },
  };
}

function edit(sessionId: string, timestamp: string, file = 'src/a.ts'): MetricsEvent {
  return {
    timestamp,
    sessionId,
    type: 'edit-allowed',
    data: { file, structuralChangePercent: 10, functionsDeleted: 0, exportsDeleted: 0 },
  };
}

describe('isSessionStartMarker', () => {
  it('recognises the session-start marker', () => {
    expect(isSessionStartMarker(start('s', '2026-10-14T10:00:00.000Z'))).toBe(true);
  });

  it('rejects ordinary edits and other event types', () => {
    expect(isSessionStartMarker(edit('s', '2026-10-14T10:00:00.000Z'))).toBe(false);
    const risk = {
      timestamp: '2026-10-14T10:00:00.000Z',
      sessionId: 's',
      type: 'risk-assessed',
      data: { file: 'session-start', rulesScore: 0, level: 'low', reasons: [] },
    } as MetricsEvent;
    expect(isSessionStartMarker(risk)).toBe(false);
  });

  it('tolerates malformed events', () => {
    expect(isSessionStartMarker({ type: 'edit-allowed' } as unknown as MetricsEvent)).toBe(false);
    expect(isSessionStartMarker(null as unknown as MetricsEvent)).toBe(false);
  });
});

describe('selectVisibleSessionIds', () => {
  it('always includes the extension session, even with no events', () => {
    expect(selectVisibleSessionIds([], ACTIVATION, EXT)).toEqual(new Set([EXT]));
  });

  it('merges parallel sessions that started after activation', () => {
    const events = [
      start('cli', '2026-10-14T10:01:00.000Z'),
      start('kanban', '2026-10-14T10:02:00.000Z'),
      edit('cli', '2026-10-14T10:03:00.000Z'),
      edit('kanban', '2026-10-14T10:03:01.000Z'),
    ];
    expect(selectVisibleSessionIds(events, ACTIVATION, EXT)).toEqual(new Set([EXT, 'cli', 'kanban']));
  });

  it('includes a session that started exactly at activation', () => {
    const events = [start('cli', '2026-10-14T10:00:00.000Z')];
    expect(selectVisibleSessionIds(events, ACTIVATION, EXT).has('cli')).toBe(true);
  });

  it('excludes sessions that started before activation, even if they write later', () => {
    const events = [
      start('old', '2026-10-14T09:59:59.999Z'),
      edit('old', '2026-10-14T10:05:00.000Z'),
    ];
    expect(selectVisibleSessionIds(events, ACTIVATION, EXT)).toEqual(new Set([EXT]));
  });

  it('excludes sessions with no session-start marker', () => {
    const events = [edit('orphan', '2026-10-14T10:05:00.000Z')];
    expect(selectVisibleSessionIds(events, ACTIVATION, EXT)).toEqual(new Set([EXT]));
  });

  it('does not depend on event order in the file', () => {
    const events = [
      edit('cli', '2026-10-14T10:03:00.000Z'),
      start('kanban', '2026-10-14T10:02:00.000Z'),
      start('old', '2026-10-14T09:00:00.000Z'),
      start('cli', '2026-10-14T10:01:00.000Z'),
    ];
    expect(selectVisibleSessionIds(events, ACTIVATION, EXT)).toEqual(new Set([EXT, 'cli', 'kanban']));
  });

  it('accepts activation time as a Date', () => {
    const events = [start('cli', '2026-10-14T10:01:00.000Z')];
    expect(selectVisibleSessionIds(events, new Date(ACTIVATION), EXT).has('cli')).toBe(true);
  });

  it('ignores markers with unparseable timestamps or missing session ids', () => {
    const events = [
      start('bad-ts', 'not-a-date'),
      start('', '2026-10-14T10:01:00.000Z'),
    ];
    expect(selectVisibleSessionIds(events, ACTIVATION, EXT)).toEqual(new Set([EXT]));
  });

  it('is not broken by unknown event types', () => {
    const events = [
      { timestamp: '2026-10-14T10:01:00.000Z', sessionId: 'cli', type: 'edit-approval', data: { file: 'x.ts' } },
      start('cli', '2026-10-14T10:00:30.000Z'),
      { timestamp: '2026-10-14T10:01:00.000Z', sessionId: 'other', type: 'something-new', data: null },
    ] as unknown as MetricsEvent[];
    expect(selectVisibleSessionIds(events, ACTIVATION, EXT)).toEqual(new Set([EXT, 'cli']));
  });
});

describe('filterVisibleEvents', () => {
  it('keeps only events from visible sessions, in original order', () => {
    const events = [
      start('old', '2026-10-14T09:00:00.000Z'),
      start(EXT, '2026-10-14T10:00:00.000Z'),
      start('cli', '2026-10-14T10:01:00.000Z'),
      edit('old', '2026-10-14T10:02:00.000Z', 'old.ts'),
      edit('cli', '2026-10-14T10:03:00.000Z', 'cli.ts'),
      edit(EXT, '2026-10-14T10:04:00.000Z', 'demo.ts'),
      { timestamp: '2026-10-14T10:05:00.000Z', sessionId: 'cli', type: 'edit-approval', data: {} } as unknown as MetricsEvent,
    ];
    const visible = filterVisibleEvents(events, ACTIVATION, EXT);
    expect(visible.map(e => `${e.sessionId}:${(e.data as { file?: string } | null)?.file ?? e.type}`)).toEqual([
      `${EXT}:session-start`,
      'cli:session-start',
      'cli:cli.ts',
      `${EXT}:demo.ts`,
      'cli:edit-approval',
    ]);
  });

  it('returns the extension session events when no plugin has run', () => {
    const events = [start(EXT, '2026-10-14T10:00:00.000Z')];
    expect(filterVisibleEvents(events, ACTIVATION, EXT)).toEqual(events);
  });
});
