/**
 * shell.ts
 *
 * `shell_edit` (SPEC.md "Risk rubric", Commands): a file changed by a
 * run_commands command instead of the editor tool, so it can't be reviewed
 * as a diff.
 */

import type { Check } from '../types';

export const shellEditCheck: Check = {
  name: 'shell_edit',
  kind: 'signal',
  run(c) {
    return c.shellEdit ? [{ category: 'shell_edit', weight: 1, detail: `changed by a shell command (${c.shellEdit})` }] : [];
  },
};
