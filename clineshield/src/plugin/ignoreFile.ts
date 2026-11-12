/**
 * <root>/.cline-shield/.gitignore containing `*`, so git ignores the whole
 * folder. Cline's "Restore chat and workspace" runs `git reset --hard`,
 * `git clean -fd` and `git stash apply` in the user's repo and leaves ignored
 * files alone (cline/cline 50e77bc,
 * sdk/packages/core/src/session/checkpoint-restore.ts); without this file a
 * restore rewinds metrics.json and deletes answers.json. A folder the user has
 * already committed stays tracked: see SPEC.md appendix.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const IGNORE_CONTENT =
  '# Written by ClineShield: keeps its logs out of git and out of Cline checkpoint restores.\n*\n';

/** Creates the file only when missing (never overwrites the user's). Never rejects. */
export async function ensureIgnoreFile(root: string): Promise<void> {
  try {
    const target = path.join(root, '.cline-shield', '.gitignore');
    await fs.mkdir(path.dirname(target), { recursive: true });
    // 'wx' is create-only: an existing file, ours or the user's, is left as is.
    await fs.writeFile(target, IGNORE_CONTENT, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error?.code !== 'EEXIST') throw error;
    });
  } catch (error) {
    console.error('[ClineShield] .cline-shield/.gitignore not written:', (error as Error)?.message ?? error);
  }
}
