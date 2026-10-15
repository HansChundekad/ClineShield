import { buildChange } from '../gather';
import type { FileInfo } from '../gather';
import { parseApplyPatch } from '../../patch';
import type { ActionContext, CheckOptions, FileChange } from '../types';

export const ROOT = '/ws';
export const HOME = '/home/u';

/** One FileChange from apply_patch body lines (without Begin/End markers). */
export function change(body: string[], info: Partial<FileInfo> = {}): FileChange {
  const op = parseApplyPatch(['*** Begin Patch', ...body, '*** End Patch'].join('\n')).operations[0];
  const abs = op.path.startsWith('/') ? op.path : `${ROOT}/${op.path}`;
  return buildChange(op, { binary: false, outsideWorkspace: false, ...info }, p => p.replace(/^\/ws\//, ''), abs);
}

export function update(file: string, removed: string[], added: string[], context: string[] = ['ctx']): string[] {
  return [`*** Update File: ${file}`, '@@', ...context.map(l => ` ${l}`), ...removed.map(l => `-${l}`), ...added.map(l => `+${l}`)];
}

export function action(changes: FileChange[], extra: Partial<ActionContext> = {}): ActionContext {
  return { workspaceRoot: ROOT, homeDir: HOME, pluginDir: '/plugins/clineshield', changes, codeownersGlobs: [], ...extra };
}

export const OPTS: CheckOptions = { protectedPaths: [], trustedDomains: [] };

export const ids = (findings: { category: string }[]) => findings.map(f => f.category);
