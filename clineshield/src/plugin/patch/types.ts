/**
 * types.ts
 *
 * Structured, lossless view of a file edit, shared by the `apply_patch`
 * parser and the `editor` adapter. Pure data: no paths are resolved and no
 * file is read. Line text is kept exactly (prefix stripped, nothing trimmed)
 * and in patch order, so an in-memory apply can be built on top of it.
 */

export type PatchLineKind = 'context' | 'remove' | 'add';

export interface PatchLine {
  kind: PatchLineKind;
  /** Line content without the patch prefix (' ', '-', '+') or line ending. */
  text: string;
}

export interface PatchHunk {
  /**
   * Text after "@@" on the hunk header ("@@ class Foo" → "class Foo"; a bare
   * "@@" → ""). Undefined when the hunk had no header (first hunk of a file,
   * or an editor edit). Upstream uses it as an anchor line to search from.
   */
  header?: string;
  /** Context / removed / added lines in patch order. */
  lines: PatchLine[];
  /** Hunk was followed by "*** End of File": it must match at the end of the file. */
  endOfFile: boolean;
  /** editor insert: insert the added lines before this one-based line. */
  insertAtLine?: number;
  /**
   * editor edits only: the exact old/new text. `lines` is the line view;
   * this keeps sub-line replacements and trailing newlines exact.
   */
  exactText?: { oldText: string; newText: string };
}

export interface AddFileOperation {
  type: 'add';
  path: string;
  /** New file content; `lines.join('\n')` is the file text. */
  lines: string[];
}

export interface DeleteFileOperation {
  type: 'delete';
  path: string;
}

export interface UpdateFileOperation {
  type: 'update';
  path: string;
  /** "*** Move to:" target, when the update also renames the file. */
  moveTo?: string;
  hunks: PatchHunk[];
}

export type FileOperation = AddFileOperation | DeleteFileOperation | UpdateFileOperation;

export interface ParsedPatch {
  /** File operations in patch order. */
  operations: FileOperation[];
  /** Problems the parser tolerated (it never throws). Empty for a clean patch. */
  warnings: string[];
}
