/**
 * measure.ts
 *
 * Edit size measurement, ported from the 1.x No-Nuke hook
 * (clineshield/hooks/PreToolUse). Pure: consumes parsed FileOperations.
 *
 *   structural change % = floor((added + removed) * 100 / (added + removed + context))
 *
 * Function detection is the 1.x regex (function declarations and
 * `const x = … =>` arrows); class methods are not detected.
 */

import type { FileOperation } from '../patch';

// 1.x: (function\s+\w+\s*\(|^\s*export\s+(async\s+)?function\s+\w+|const\s+\w+\s*=\s*.*=>)
const FUNCTION_SIGNATURE = /function\s+\w+\s*\(|^\s*export\s+(async\s+)?function\s+\w+|const\s+\w+\s*=\s*.*=>/;
const EXPORT_LINE = /^\s*export\b/;

export interface EditMeasurement {
  /** File path as written in the tool input. */
  path: string;
  operation: FileOperation['type'];
  addedLines: number;
  removedLines: number;
  contextLines: number;
  /** added + removed + context: the "patch lines" the % rule is gated on. */
  patchLines: number;
  /** Integer percent (floor, as 1.x); 0 for an empty patch. */
  structuralChangePercent: number;
  functionsAdded: number;
  functionsDeleted: number;
  exportsDeleted: number;
}

export function looksLikeFunctionSignature(line: string): boolean {
  return FUNCTION_SIGNATURE.test(line);
}

export function looksLikeExport(line: string): boolean {
  return EXPORT_LINE.test(line);
}

/**
 * Measures one file operation. A Delete File measures as zero: the parser
 * has no file contents, so there is nothing to count.
 */
export function measureOperation(op: FileOperation): EditMeasurement {
  const m: EditMeasurement = {
    path: op.path,
    operation: op.type,
    addedLines: 0,
    removedLines: 0,
    contextLines: 0,
    patchLines: 0,
    structuralChangePercent: 0,
    functionsAdded: 0,
    functionsDeleted: 0,
    exportsDeleted: 0,
  };

  const added = (text: string) => {
    m.addedLines++;
    if (looksLikeFunctionSignature(text)) m.functionsAdded++;
  };

  if (op.type === 'add') {
    op.lines.forEach(added);
  } else if (op.type === 'update') {
    for (const hunk of op.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') {
          added(line.text);
        } else if (line.kind === 'remove') {
          m.removedLines++;
          if (looksLikeFunctionSignature(line.text)) m.functionsDeleted++;
          if (looksLikeExport(line.text)) m.exportsDeleted++;
        } else {
          m.contextLines++;
        }
      }
    }
  }

  const changed = m.addedLines + m.removedLines;
  m.patchLines = changed + m.contextLines;
  m.structuralChangePercent = m.patchLines > 0 ? Math.floor((changed * 100) / m.patchLines) : 0;
  return m;
}
