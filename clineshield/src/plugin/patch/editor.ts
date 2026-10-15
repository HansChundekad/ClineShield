/**
 * editor.ts
 *
 * Turns an SDK `editor` tool input into the same FileOperation structure the
 * apply_patch parser produces. Input schema (cline/cline main @ 789f79e,
 * sdk/packages/core/src/extensions/tools/schemas.ts `EditFileInputSchema`):
 *   { path, old_text?: string | null, new_text: string, insert_line?: number | null }
 * Modes (executors/editor.ts): insert_line set → insert before that line;
 * old_text missing → create the file; otherwise replace old_text once.
 */

import type { FileOperation, PatchLine } from './types';

/** Above this many LCS cells the diff falls back to "all removed, all added". */
const LCS_CELL_BUDGET = 250_000;

/** Line view of a text block: one trailing newline does not make an extra line. */
function toLines(text: string): string[] {
  if (text === '') return [];
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

/**
 * Line diff of two blocks as patch lines: equal lines are context, the rest
 * removed/added (removals before additions in each changed run). Common
 * prefix/suffix are trimmed first; the middle uses LCS within a cell budget.
 */
export function diffLines(oldLines: string[], newLines: string[]): PatchLine[] {
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const out: PatchLine[] = oldLines.slice(0, start).map(text => ({ kind: 'context' as const, text }));
  const a = oldLines.slice(start, oldEnd);
  const b = newLines.slice(start, newEnd);

  if (a.length * b.length > LCS_CELL_BUDGET) {
    for (const text of a) out.push({ kind: 'remove', text });
    for (const text of b) out.push({ kind: 'add', text });
  } else {
    // lcs[i][j] = LCS length of a[i..] and b[j..], flattened.
    const cols = b.length + 1;
    const lcs = new Uint32Array((a.length + 1) * cols);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i * cols + j] =
          a[i] === b[j] ? lcs[(i + 1) * cols + j + 1] + 1 : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    const removed: PatchLine[] = [];
    const added: PatchLine[] = [];
    const flush = () => {
      out.push(...removed, ...added);
      removed.length = 0;
      added.length = 0;
    };
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        flush();
        out.push({ kind: 'context', text: a[i] });
        i++;
        j++;
      } else if (j >= b.length || (i < a.length && lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])) {
        removed.push({ kind: 'remove', text: a[i++] });
      } else {
        added.push({ kind: 'add', text: b[j++] });
      }
    }
    flush();
  }

  for (const text of oldLines.slice(oldEnd)) out.push({ kind: 'context', text });
  return out;
}

/** Converts an `editor` tool input to a FileOperation; undefined if malformed. */
export function editorInputToOperation(input: unknown): FileOperation | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const { path, old_text: oldText, new_text: newText, insert_line: insertLine } = input as Record<string, unknown>;
  if (typeof path !== 'string' || path === '' || typeof newText !== 'string') return undefined;

  const insertAt = insertLine === null || insertLine === undefined || insertLine === '' ? NaN : Number(insertLine);
  if (Number.isFinite(insertAt)) {
    return {
      type: 'update',
      path,
      hunks: [
        {
          endOfFile: false,
          insertAtLine: insertAt,
          exactText: { oldText: '', newText },
          lines: toLines(newText).map(text => ({ kind: 'add' as const, text })),
        },
      ],
    };
  }

  if (typeof oldText !== 'string') {
    return { type: 'add', path, lines: newText.split('\n') };
  }

  return {
    type: 'update',
    path,
    hunks: [
      {
        endOfFile: false,
        exactText: { oldText, newText },
        lines: diffLines(toLines(oldText), toLines(newText)),
      },
    ],
  };
}
