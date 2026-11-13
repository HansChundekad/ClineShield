/** What a tool call does, in the terms the labeller and the join need. Reuses the plugin's own parsers. */
import * as path from 'path';
import { applyPatchInputText, editorInputToOperation, parseApplyPatch } from '../../clineshield/src/plugin/patch';
import type { FileOperation } from '../../clineshield/src/plugin/patch';
import { displayCommand, normaliseCommands } from '../../clineshield/src/plugin/rubric/commands';
import { entryText } from '../../clineshield/src/plugin/rubric/commands/parse';
import type { ToolCall } from './types';

export interface FileTouch { path: string; op: 'add' | 'delete' | 'update'; added: string[]; removed: string[] }
export interface Action { kind: 'edit' | 'command' | 'other'; files: FileTouch[]; commands: string[]; displayCommand?: string }

const EDIT_TOOLS = new Set(['editor', 'apply_patch']);

/** Workspace-relative with '/' separators, like the plugin's displayPath; absolute when outside. */
export function relPath(root: string, p: string): string {
  const rel = path.relative(root, path.resolve(root, p));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return path.resolve(root, p);
  return rel.split(path.sep).join('/');
}

function touch(op: FileOperation, root: string): FileTouch {
  if (op.type === 'add') return { path: relPath(root, op.path), op: 'add', added: op.lines, removed: [] };
  if (op.type === 'delete') return { path: relPath(root, op.path), op: 'delete', added: [], removed: [] };
  const lines = op.hunks.flatMap(h => h.lines);
  return {
    path: relPath(root, op.path), op: 'update',
    added: lines.filter(l => l.kind === 'add').map(l => l.text),
    removed: lines.filter(l => l.kind === 'remove').map(l => l.text),
  };
}

export function describeAction(call: ToolCall, root: string): Action {
  if (call.name === 'run_commands') {
    const entries = normaliseCommands(call.input) ?? [];
    const commands = entries.map(entryText);
    return { kind: 'command', files: [], commands, displayCommand: displayCommand(commands.join('; ')) };
  }
  if (EDIT_TOOLS.has(call.name)) {
    let ops: FileOperation[] = [];
    if (call.name === 'editor') {
      const op = editorInputToOperation(call.input);
      ops = op ? [op] : [];
    } else {
      const text = applyPatchInputText(call.input);
      ops = text ? parseApplyPatch(text).operations : [];
    }
    return { kind: 'edit', files: ops.map(o => touch(o, root)), commands: [] };
  }
  return { kind: 'other', files: [], commands: [] };
}
