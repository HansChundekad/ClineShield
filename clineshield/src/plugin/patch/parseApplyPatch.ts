/**
 * parseApplyPatch.ts
 *
 * Parses the Cline `apply_patch` grammar into structured file operations.
 * Mirrors the upstream parser's line handling (cline/cline main @ 789f79e,
 * sdk/packages/core/src/extensions/tools/executors/apply-patch-parser.ts and
 * apply-patch.ts `normalizePatchInput`) but needs no file contents: hunks are
 * kept as written instead of being located in the file. Lenient by design —
 * problems become warnings, never exceptions — because it runs inside hooks.
 */

import type { FileOperation, ParsedPatch, PatchHunk, PatchLine, UpdateFileOperation } from './types';

export const PATCH_MARKERS = {
  BEGIN: '*** Begin Patch',
  END: '*** End Patch',
  ADD: '*** Add File: ',
  UPDATE: '*** Update File: ',
  DELETE: '*** Delete File: ',
  MOVE: '*** Move to: ',
  END_OF_FILE: '*** End of File',
} as const;

const WRAPPER_PREFIXES = ['%%bash', 'apply_patch', 'EOF', '```'];

/**
 * Extracts the patch text from an `apply_patch` tool input. The SDK accepts
 * `{ input: string }` or a bare string (schemas.ts `ApplyPatchInputUnionSchema`).
 */
export function applyPatchInputText(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && typeof (input as { input?: unknown }).input === 'string') {
    return (input as { input: string }).input;
  }
  return undefined;
}

function isWrapperLine(line: string): boolean {
  return line.trim() !== '' && WRAPPER_PREFIXES.some(w => line.startsWith(w));
}

/** Returns the lines between the sentinels (exclusive), as upstream does. */
function patchBody(text: string, warnings: string[]): string[] {
  const raw = text.split('\n').map(l => l.replace(/\r$/, ''));
  const begin = raw.findIndex(l => l.startsWith(PATCH_MARKERS.BEGIN));
  let end = -1;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i].startsWith(PATCH_MARKERS.END)) {
      end = i;
      break;
    }
  }

  if (begin !== -1 && end > begin) return raw.slice(begin + 1, end);
  if (begin !== -1 || end !== -1) {
    warnings.push('Incomplete patch sentinels (*** Begin Patch / *** End Patch); parsed what was there');
    return raw.slice(begin === -1 ? 0 : begin + 1, end > begin ? end : raw.length);
  }

  let start = 0;
  let stop = raw.length;
  while (start < stop && isWrapperLine(raw[start])) start++;
  while (stop > start && isWrapperLine(raw[stop - 1])) stop--;
  while (start < stop && raw[start] === '') start++;
  while (stop > start && raw[stop - 1] === '') stop--;
  return raw.slice(start, stop);
}

function toPatchLine(line: string): PatchLine {
  switch (line[0]) {
    case '+':
      return { kind: 'add', text: line.slice(1) };
    case '-':
      return { kind: 'remove', text: line.slice(1) };
    case ' ':
      return { kind: 'context', text: line.slice(1) };
    default:
      // Upstream treats an unprefixed line as context with the whole line as text.
      return { kind: 'context', text: line };
  }
}

function isFileMarker(line: string): boolean {
  return line.startsWith(PATCH_MARKERS.ADD) || line.startsWith(PATCH_MARKERS.UPDATE) || line.startsWith(PATCH_MARKERS.DELETE);
}

/** Parses `apply_patch` text into file operations. Never throws. */
export function parseApplyPatch(text: string): ParsedPatch {
  const warnings: string[] = [];
  const operations: FileOperation[] = [];
  if (typeof text !== 'string' || text === '') return { operations, warnings };

  const lines = patchBody(text, warnings);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith(PATCH_MARKERS.DELETE)) {
      operations.push({ type: 'delete', path: line.slice(PATCH_MARKERS.DELETE.length).trim() });
      i++;
      continue;
    }

    if (line.startsWith(PATCH_MARKERS.ADD)) {
      const path = line.slice(PATCH_MARKERS.ADD.length).trim();
      const content: string[] = [];
      i++;
      while (i < lines.length && !isFileMarker(lines[i])) {
        const l = lines[i++];
        if (l.startsWith('+')) content.push(l.slice(1));
        else warnings.push(`Add File ${path}: line without '+' ignored: ${l}`);
      }
      operations.push({ type: 'add', path, lines: content });
      continue;
    }

    if (line.startsWith(PATCH_MARKERS.UPDATE)) {
      const op: UpdateFileOperation = { type: 'update', path: line.slice(PATCH_MARKERS.UPDATE.length).trim(), hunks: [] };
      i++;
      if (i < lines.length && lines[i].startsWith(PATCH_MARKERS.MOVE)) {
        op.moveTo = lines[i].slice(PATCH_MARKERS.MOVE.length).trim();
        i++;
      }

      let hunk: PatchHunk | undefined;
      while (i < lines.length && !isFileMarker(lines[i])) {
        const l = lines[i++];
        if (l.startsWith('@@')) {
          hunk = { header: l.slice(2).replace(/^ /, ''), lines: [], endOfFile: false };
          op.hunks.push(hunk);
        } else if (l === PATCH_MARKERS.END_OF_FILE) {
          if (hunk) hunk.endOfFile = true;
          hunk = undefined;
        } else if (l === '***') {
          // Upstream stops a chunk on a bare "***"; nothing to record.
        } else if (l.startsWith('***')) {
          warnings.push(`Update File ${op.path}: unknown marker ignored: ${l}`);
        } else {
          if (!hunk) {
            hunk = { lines: [], endOfFile: false };
            op.hunks.push(hunk);
          }
          hunk.lines.push(toPatchLine(l));
        }
      }
      operations.push(op);
      continue;
    }

    warnings.push(`Line outside any file section ignored: ${line}`);
    i++;
  }

  return { operations, warnings };
}
