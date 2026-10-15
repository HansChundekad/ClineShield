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
import { randomBytes } from 'crypto';
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
// Per-workspace write queue: serialises read-modify-write within this process,
// preventing concurrent writes from racing on the same metrics.json.
const writeQueues = new Map<string, Promise<void>>();

// Cross-process lock (metrics.json.lock): the Cline plugin runs in its own
// worker process per session and the VS Code extension in the extension host,
// so the in-process queue alone lets one writer's rename drop the other's event.
// A lock is held for one read-modify-write (milliseconds). Older than
// LOCK_STALE_MS means its writer crashed. After LOCK_WAIT_MS we write anyway:
// losing an event beats blocking a hook (3s host timeout).
export const LOCK_STALE_MS = 5000;
export const LOCK_WAIT_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Returns a release function, or undefined if the lock could not be taken in time. */
async function acquireLock(lockPath: string): Promise<(() => Promise<void>) | undefined> {
  const token = `${process.pid}.${randomBytes(6).toString('hex')}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await fs.writeFile(lockPath, token, { flag: 'wx' });
      return async () => {
        try {
          // Only remove the lock if it is still ours (not taken over as stale).
          if ((await fs.readFile(lockPath, 'utf-8')) === token) await fs.unlink(lockPath);
        } catch { /* already gone */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    try {
      const { mtimeMs } = await fs.stat(lockPath);
      if (Date.now() - mtimeMs > LOCK_STALE_MS) {
        await fs.unlink(lockPath);
        continue;
      }
    } catch {
      continue; // released between our create attempt and stat: retry now
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(5 + Math.random() * 10);
  }
}

export async function appendEvent(
  event: MetricsEvent,
  workspaceRoot: string
): Promise<void> {
  const key = getMetricsPath(workspaceRoot);
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev.then(() => doAppend(event, workspaceRoot)).catch(() => {});
  writeQueues.set(key, next);
  return next;
}

async function doAppend(
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

    const release = await acquireLock(`${metricsPath}.lock`);
    if (!release) {
      console.error('[ClineShield] metrics.json lock busy, writing without it');
    }
    try {
      await readModifyWrite(event, metricsPath);
    } finally {
      await release?.();
    }
  } catch (error) {
    console.error('[ClineShield] Failed to append event to metrics.json:', error);
    // Don't throw - hooks must not crash
  }
}

async function readModifyWrite(event: MetricsEvent, metricsPath: string): Promise<void> {
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

  // Unique temp path prevents concurrent writers from clobbering each other's temp.
  const suffix = `${Date.now()}.${randomBytes(4).toString('hex')}`;
  const tempPath = `${metricsPath}.${suffix}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(events, null, 2), 'utf-8');
  try {
    await fs.rename(tempPath, metricsPath);
  } catch (renameError) {
    try { await fs.unlink(tempPath); } catch { /* ignore */ }
    throw renameError;
  }
}
