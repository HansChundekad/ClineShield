/**
 * messages.ts
 *
 * Text Cline sees. Reasons and fixes only: never points or cut-offs, so the
 * model can't learn to slip under them (SPEC.md "Reasons").
 */

import { COMMAND_ITEM } from './engine';
import type { Decision, Finding } from './engine';

export const REPEAT_BLOCK_NOTE = 'Stop and ask the user how to proceed.';

function top(d: Decision): Array<Finding & { file: string }> {
  return d.files
    .flatMap(f => f.findings.filter(x => !x.logOnly).map(x => ({ ...x, file: f.file })))
    .sort((a, b) => Number(b.block) - Number(a.block) || b.points - a.points)
    .slice(0, 3);
}

const why = (items: Array<Finding & { file: string }>) => items.map(x => (x.file === COMMAND_ITEM ? x.detail : `${x.file}: ${x.detail}`)).join('; ');

export function blockMessage(d: Decision): string {
  const t = top(d);
  return (
    `ClineShield blocked this action, so nothing was changed. Why: ${why(t)}. ` +
    `Fix: ${t[0]?.fix ?? 'Make a smaller, targeted change.'} ` +
    "Don't retry the same change in smaller pieces to get around this."
  );
}

export function askMessage(d: Decision): string {
  const t = top(d);
  if (t.length === 0) {
    return 'ClineShield could not check this action and asked the user to approve it. If the user says no, ask them what they want.';
  }
  return `ClineShield asked the user to approve this action. Why: ${why(t)}. If the user says no, don't retry the same action; ask them what they want.`;
}
