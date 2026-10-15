/**
 * policy.ts
 *
 * Edit Size Policy (SPEC.md Part 2): classifies an `apply_patch` / `editor`
 * call on TS/JS files as allow · approve · block. Pure: the plugin hooks in
 * ../index.ts turn the decision into hook results and metrics events.
 */

import { applyPatchInputText, editorInputToOperation, parseApplyPatch } from '../patch';
import type { FileOperation } from '../patch';
import { measureOperation } from './measure';
import type { EditMeasurement } from './measure';

/**
 * Tier thresholds. Hard-coded SPEC defaults (Open decision #4, decided
 * 2026-10-14); they move to `.cline-shield.yml` with the Configuration feature.
 * The % rules only apply to patches with more than `minPatchLinesForPercent` lines.
 */
export const EDIT_SIZE_THRESHOLDS = {
  minPatchLinesForPercent: 10,
  block: { functionsDeletedAbove: 3, changePercentAbove: 75 },
  approve: { functionsDeletedAtLeast: 2, changePercentAtLeast: 40 },
} as const;

export type EditSizeThresholds = typeof EDIT_SIZE_THRESHOLDS;
export type EditTier = 'allow' | 'approve' | 'block';

export interface FileVerdict {
  /** Display path (after `displayPath`); used in messages and events. */
  file: string;
  tier: EditTier;
  measurement: EditMeasurement;
  /** One phrase per triggered rule, e.g. "4 functions deleted (limit 3)". */
  reasons: string[];
}

export interface EditDecision {
  /** Worst tier over all evaluated files. */
  tier: EditTier;
  /** One verdict per evaluated TS/JS file, in patch order. */
  files: FileVerdict[];
  /** block: the skip reason for the model. approve: the appendContext note. allow: ''. */
  message: string;
}

export interface EvaluateOptions {
  displayPath?: (path: string) => string;
  thresholds?: EditSizeThresholds;
}

const GUARDED_EXTENSION = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;
const TIER_RANK: Record<EditTier, number> = { allow: 0, approve: 1, block: 2 };

export function isGuardedPath(path: string): boolean {
  return GUARDED_EXTENSION.test(path);
}

export function classifyEdit(
  m: EditMeasurement,
  t: EditSizeThresholds = EDIT_SIZE_THRESHOLDS
): { tier: EditTier; reasons: string[] } {
  // A new file cannot destroy existing code.
  if (m.operation === 'add') return { tier: 'allow', reasons: [] };

  const fns = (n: number) => `${n} function${n === 1 ? '' : 's'} deleted`;
  const pct = `${m.structuralChangePercent}% of a ${m.patchLines}-line patch changed`;
  const percentApplies = m.patchLines > t.minPatchLinesForPercent;
  const over = `for patches over ${t.minPatchLinesForPercent} lines`;

  const block: string[] = [];
  if (m.functionsDeleted > t.block.functionsDeletedAbove) {
    block.push(`${fns(m.functionsDeleted)} (limit ${t.block.functionsDeletedAbove})`);
  }
  if (percentApplies && m.structuralChangePercent > t.block.changePercentAbove) {
    block.push(`${pct} (limit ${t.block.changePercentAbove}% ${over})`);
  }
  if (block.length > 0) return { tier: 'block', reasons: block };

  const approve: string[] = [];
  if (m.functionsDeleted >= t.approve.functionsDeletedAtLeast) {
    approve.push(`${fns(m.functionsDeleted)} (approval needed from ${t.approve.functionsDeletedAtLeast})`);
  }
  if (percentApplies && m.structuralChangePercent >= t.approve.changePercentAtLeast) {
    approve.push(`${pct} (approval needed from ${t.approve.changePercentAtLeast}% ${over})`);
  }
  if (approve.length > 0) return { tier: 'approve', reasons: approve };

  return { tier: 'allow', reasons: [] };
}

function operationsFor(toolName: string, input: unknown): FileOperation[] | undefined {
  if (toolName === 'apply_patch') {
    const text = applyPatchInputText(input);
    return text === undefined ? undefined : parseApplyPatch(text).operations;
  }
  if (toolName === 'editor') {
    const op = editorInputToOperation(input);
    return op ? [op] : undefined;
  }
  return undefined;
}

function describe(files: FileVerdict[], tier: EditTier): string {
  return files
    .filter(f => f.tier === tier)
    .map(f => `${f.file}: ${f.reasons.join('; ')}`)
    .join('. ');
}

export function blockMessage(files: FileVerdict[]): string {
  return (
    `ClineShield blocked this edit, so nothing was changed. ${describe(files, 'block')}. ` +
    'Make smaller, targeted edits instead: change one function or block at a time, keep a few unchanged ' +
    'lines as context, and do not delete or rewrite functions the task does not require. ' +
    'If a large rewrite is really needed, ask the user first.'
  );
}

export function approvalMessage(files: FileVerdict[]): string {
  return (
    `ClineShield asked the user to approve this edit because it is larger than usual. ${describe(files, 'approve')}. ` +
    'If the user rejects it, do not retry the same edit: ask what they want, or make a smaller change.'
  );
}

/**
 * Evaluates one tool call. Returns undefined when the policy has no opinion:
 * not an edit tool, malformed input, or no TS/JS file updated or created.
 * Delete File operations are not evaluated (1.x behaviour; Open decision #8).
 */
export function evaluateEdit(toolName: string, input: unknown, options: EvaluateOptions = {}): EditDecision | undefined {
  const ops = operationsFor(toolName, input);
  if (!ops) return undefined;
  const display = options.displayPath ?? ((p: string) => p);

  const files: FileVerdict[] = ops
    .filter(op => op.type !== 'delete' && isGuardedPath(op.path))
    .map(op => {
      const measurement = measureOperation(op);
      const { tier, reasons } = classifyEdit(measurement, options.thresholds);
      return { file: display(op.path), tier, measurement, reasons };
    });
  if (files.length === 0) return undefined;

  const tier = files.reduce<EditTier>((worst, f) => (TIER_RANK[f.tier] > TIER_RANK[worst] ? f.tier : worst), 'allow');
  const message = tier === 'block' ? blockMessage(files) : tier === 'approve' ? approvalMessage(files) : '';
  return { tier, files, message };
}
