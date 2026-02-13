/**
 * writer.ts
 *
 * Writes events to metrics.json
 *
 * @param event - The metrics event to append
 * @param workspaceRoot - The workspace root directory
 */



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
 * Gets the path to .cline-shield directory
 * @param workspaceRoot - The workspace root directory
 */
function getMetricsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, METRICS_DIR);
}

/**
 * Appends a new event to metrics.json
 * Creates directory and file if they don't exist
 * Does not throw errors - logs to console.error instead
 *
 * @param event - The metrics event to append
 * @param workspaceRoot - The workspace root directory
 */
export async function appendEvent(
  event: MetricsEvent,
  workspaceRoot: string
): Promise<void> {
  try {
    const metricsDir = getMetricsDir(workspaceRoot);
    const metricsPath = getMetricsPath(workspaceRoot);

    // Ensure .cline-shield directory exists
    try {
      await fs.access(metricsDir);
    } catch {
      await fs.mkdir(metricsDir, { recursive: true });
    }

    // Read existing events or create empty array
    let events: MetricsEvent[] = [];
    try {
      const content = await fs.readFile(metricsPath, 'utf-8');
      try {
        events = JSON.parse(content);

        // Validate it's an array
        if (!Array.isArray(events)) {
          console.error('[ClineShield] metrics.json is not an array, resetting to empty');
          events = [];
        }
      } catch (parseError) {
        // Malformed JSON - log and reset
        console.error('[ClineShield] metrics.json contains invalid JSON, resetting to empty:', parseError instanceof Error ? parseError.message : parseError);
        events = [];
      }
    } catch (error) {
      // File doesn't exist - start fresh
      events = [];
    }

    // Append new event
    events.push(event);

    // Atomic write: temp file + rename
    // This prevents corruption if process crashes mid-write
    const tempPath = `${metricsPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(events, null, 2), 'utf-8');
    await fs.rename(tempPath, metricsPath);
  } catch (error) {
    console.error('[ClineShield] Failed to append event to metrics.json:', error);
    // Don't throw - hooks must not crash
  }
}
