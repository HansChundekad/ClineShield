/**
 * apply.ts
 *
 * Pure in-memory apply of a FileOperation to file text, so the rubric can
 * compare before/after while the file on disk is still unchanged. Stricter
 * than the SDK executor (exact, then trailing-whitespace-insensitive): a
 * miss only makes the rubric fall back to patch-only measures.
 */

import type { FileOperation, PatchHunk } from './types';

export type ApplyResult = { ok: true; text: string } | { ok: false; reason: string };

function findBlock(lines: string[], block: string[], from: number, atEnd: boolean): number {
  const eq = [(a: string, b: string) => a === b, (a: string, b: string) => a.trimEnd() === b.trimEnd()];
  for (const same of eq) {
    const start = atEnd ? lines.length - block.length : from;
    const last = lines.length - block.length;
    for (let i = Math.max(0, start); i <= last; i++) {
      let hit = true;
      for (let j = 0; j < block.length; j++) {
        if (!same(lines[i + j], block[j])) { hit = false; break; }
      }
      if (hit) return i;
      if (atEnd) break;
    }
  }
  return -1;
}

function applyHunk(lines: string[], hunk: PatchHunk, cursor: number): { lines: string[]; cursor: number } | undefined {
  if (hunk.insertAtLine !== undefined) {
    const at = hunk.insertAtLine - 1;
    if (at < 0 || at > lines.length) return undefined;
    const added = hunk.lines.filter(l => l.kind === 'add').map(l => l.text);
    return { lines: [...lines.slice(0, at), ...added, ...lines.slice(at)], cursor: at + added.length };
  }
  const oldBlock = hunk.lines.filter(l => l.kind !== 'add').map(l => l.text);
  const newBlock = hunk.lines.filter(l => l.kind !== 'remove').map(l => l.text);
  if (oldBlock.length === 0) {
    return { lines: [...lines, ...newBlock], cursor: lines.length + newBlock.length };
  }
  const at = findBlock(lines, oldBlock, cursor, hunk.endOfFile);
  if (at < 0) return undefined;
  return { lines: [...lines.slice(0, at), ...newBlock, ...lines.slice(at + oldBlock.length)], cursor: at + newBlock.length };
}

export function applyOperation(original: string, op: FileOperation): ApplyResult {
  if (op.type === 'add') return { ok: true, text: op.lines.join('\n') };
  if (op.type === 'delete') return { ok: true, text: '' };

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const normalized = original.replace(/\r\n/g, '\n');
  const trailing = normalized.endsWith('\n');

  // editor replace: exact text, exactly once.
  const only = op.hunks.length === 1 ? op.hunks[0] : undefined;
  if (only?.exactText && only.insertAtLine === undefined) {
    const oldText = only.exactText.oldText.replace(/\r\n/g, '\n');
    const first = normalized.indexOf(oldText);
    if (oldText === '' || first < 0 || normalized.indexOf(oldText, first + 1) >= 0) {
      return { ok: false, reason: 'old_text not found exactly once' };
    }
    const next = normalized.slice(0, first) + only.exactText.newText.replace(/\r\n/g, '\n') + normalized.slice(first + oldText.length);
    return { ok: true, text: next.replace(/\n/g, eol) };
  }

  let lines = (trailing ? normalized.slice(0, -1) : normalized).split('\n');
  if (normalized === '') lines = [];
  let cursor = 0;
  for (const hunk of op.hunks) {
    const r = applyHunk(lines, hunk, cursor);
    if (!r) return { ok: false, reason: 'hunk does not match the file' };
    lines = r.lines;
    cursor = r.cursor;
  }
  return { ok: true, text: lines.join(eol) + (trailing ? eol : '') };
}
