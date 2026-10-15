/**
 * Patch model: pure parsing of edit tool inputs into structured file
 * operations. No I/O, thresholds or policy here (see ../editPolicy).
 */

export * from './types';
export { PATCH_MARKERS, applyPatchInputText, parseApplyPatch } from './parseApplyPatch';
export { diffLines, editorInputToOperation } from './editor';
