/**
 * session.ts (check)
 *
 * Log-only session signals (SPEC.md "Risk rubric", Session row, ④): read from
 * the session memory (rubric/session.ts) handed in on ActionContext.session.
 * Pure. Only apply_patch / editor changes: shell-edited files are skipped.
 * Unknowns never fire (exists unknown → no unread_file).
 */

import { CATEGORIES } from '../categories';
import { CHURN_LIMIT, EDIT_LOOP_PRIOR } from '../session';
import type { CategoryId, Check, FileChange, RawFinding } from '../types';

const finding = (category: CategoryId, text: string): RawFinding =>
  ({ category, weight: 1, detail: `${text} (would add ${CATEGORIES[category].max})` });

const lines = (c: FileChange) => c.added.length + c.removed.length;

export const sessionCheck: Check = {
  name: 'session',
  kind: 'signal',
  run(c, a) {
    const s = a.session;
    if (!s || c.shellEdit) return [];
    const out: RawFinding[] = [];
    const prior = s.priorEdits(c.path);
    if (prior >= EDIT_LOOP_PRIOR) out.push(finding('edit_loop', `edit ${prior + 1} of this file in 10 minutes`));
    if (c.exists === true && c.kind !== 'add' && !s.known(c.path)) out.push(finding('unread_file', `edits ${c.path} without reading it first`));
    if (c === a.changes[0]) {
      const total = s.churn + a.changes.filter(x => !x.shellEdit).reduce((n, x) => n + lines(x), 0);
      if (total > CHURN_LIMIT) out.push(finding('session_churn', `${total} lines changed this session`));
    }
    return out;
  },
};
