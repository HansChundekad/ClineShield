import * as fs from 'fs/promises';
import * as path from 'path';
import type { MetricsEvent } from '../types/metrics';

const METRICS_DIR = '.cline-shield';
const METRICS_FILE = 'metrics.json';

/**
 * Gets the path to metrics.json relative to workspace root
 * @param workspaceRoot - The workspace root directory
 */
function getMetricsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, METRICS_DIR, METRICS_FILE);
}

/**
 * Reads all events from metrics.json
 * Returns empty array if file doesn't exist or on parse errors
 *
 * @param workspaceRoot - The workspace root directory
 * @returns Array of metrics events
 */
export async function readEvents(workspaceRoot: string): Promise<MetricsEvent[]> {
  try {
    const metricsPath = getMetricsPath(workspaceRoot);
    const content = await fs.readFile(metricsPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate it's an array
    if (!Array.isArray(parsed)) {
      console.warn('[ClineShield] metrics.json is not an array, returning empty');
      return [];
    }

    return parsed as MetricsEvent[];
  } catch (error) {
    // File doesn't exist or parse error - return empty array
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[ClineShield] Failed to read metrics.json:', error);
    }
    return [];
  }
}

/**
 * Reads events filtered by session ID
 *
 * @param sessionId - The session ID to filter by
 * @param workspaceRoot - The workspace root directory
 * @returns Array of metrics events for the session
 */
export async function readEventsBySession(
  sessionId: string,
  workspaceRoot: string
): Promise<MetricsEvent[]> {
  const events = await readEvents(workspaceRoot);
  return events.filter(event => event.sessionId === sessionId);
}

/**
 * Reads events filtered by type with type-safe return
 *
 * @param type - The event type to filter by
 * @param workspaceRoot - The workspace root directory
 * @returns Array of metrics events of the specified type
 */
export async function readEventsByType<T extends MetricsEvent['type']>(
  type: T,
  workspaceRoot: string
): Promise<Extract<MetricsEvent, { type: T }>[]> {
  const events = await readEvents(workspaceRoot);
  return events.filter(event => event.type === type) as Extract<MetricsEvent, { type: T }>[];
}
