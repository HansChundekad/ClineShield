import type { MetricsEvent } from '../types/metrics';

/**
 * Session selection for the VS Code dashboards (sidebar, change map, status bar).
 *
 * The dashboards show every session that started since the extension activated:
 * any session id whose `session-start` marker has a timestamp >= activation time,
 * plus the extension's own session id (used by "Generate Test Metrics" and
 * `llm-analysis` events). Parallel Cline sessions (CLI + Kanban) are merged.
 * Pure functions: no I/O, no vscode import, safe on unknown event types.
 */

/** The marker both extension.ts and the plugin write when a session starts. */
export function isSessionStartMarker(event: MetricsEvent): boolean {
  if (!event || event.type !== 'edit-allowed') return false;
  const data = event.data as { file?: unknown } | null | undefined;
  return data?.file === 'session-start';
}

export function selectVisibleSessionIds(
  events: readonly MetricsEvent[],
  activationTime: number | Date,
  extensionSessionId: string
): Set<string> {
  const since = activationTime instanceof Date ? activationTime.getTime() : activationTime;
  const visible = new Set<string>([extensionSessionId]);

  for (const event of events) {
    if (!isSessionStartMarker(event)) continue;
    if (typeof event.sessionId !== 'string' || !event.sessionId) continue;
    const startedAt = Date.parse(event.timestamp);
    if (Number.isNaN(startedAt) || startedAt < since) continue;
    visible.add(event.sessionId);
  }

  return visible;
}

/** Events belonging to visible sessions, in their original file order. */
export function filterVisibleEvents(
  events: readonly MetricsEvent[],
  activationTime: number | Date,
  extensionSessionId: string
): MetricsEvent[] {
  const ids = selectVisibleSessionIds(events, activationTime, extensionSessionId);
  return events.filter(event => !!event && ids.has(event.sessionId));
}
