/**
 * Patch model: pure parsing of edit tool inputs into structured file
 * operations, plus a pure in-memory apply. No I/O, thresholds or policy here.
 */

export * from './types';
export { PATCH_MARKERS, applyPatchInputText, parseApplyPatch } from './parseApplyPatch';
export { diffLines, editorInputToOperation } from './editor';
export { applyOperation } from './apply';
export type { ApplyResult } from './apply';
