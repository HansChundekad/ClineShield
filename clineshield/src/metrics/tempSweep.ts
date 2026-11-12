/**
 * tempSweep.ts
 *
 * Atomic writers (temp + rename) leave a complete `<file>.<id>.tmp` behind
 * when their process is killed between the write and the rename (Cline ends a
 * plugin hook after 3 s). Each writer calls this first: temps of the same
 * target older than STALE_TEMP_MS are removed. A live write takes
 * milliseconds, so a fresh temp is never touched. Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const STALE_TEMP_MS = 30_000;

export async function sweepStaleTemps(target: string, now: number = Date.now()): Promise<void> {
  const dir = path.dirname(target);
  const prefix = `${path.basename(target)}.`;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const candidates = names.filter(n => n.startsWith(prefix) && n.endsWith('.tmp') && n.length > prefix.length + '.tmp'.length);
  await Promise.all(candidates.map(async name => {
    const file = path.join(dir, name);
    try {
      if (now - (await fs.stat(file)).mtimeMs > STALE_TEMP_MS) await fs.unlink(file);
    } catch { /* gone already, or not ours to remove */ }
  }));
}
