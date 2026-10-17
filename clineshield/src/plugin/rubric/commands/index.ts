/**
 * Risk rubric for run_commands (SPEC.md "Risk rubric", Commands):
 * normalise → parse → analyze (command findings + file targets) → gather
 * (targets → FileChanges) → one ActionContext for the shared engine.
 * All commands of one request are one action.
 */

import * as os from 'os';
import { SECRET_PATTERNS } from '../checks/hard';
import type { ActionContext } from '../types';
import { analyze } from './analyze';
import { gatherTargets } from './gather';
import { normaliseCommands } from './normalise';
import { ParseError, entryText, parseEntries } from './parse';

export { normaliseCommands } from './normalise';

export const MAX_COMMAND_CHARS = 500;
export const UNPARSED_COMMANDS = '(unparsed run_commands input)';

export interface CommandsOptions {
  workspaceRoot: string;
  homeDir: string;
  pluginDir: string;
  codeownersGlobs: string[];
  trustedCommands: string[];
  tempDirs?: string[];
  budgetMs?: number;
  gitTimeoutMs?: number;
}

export interface CommandsResult {
  /** Display text for logs: entries joined, secrets masked, capped. */
  command: string;
  action?: ActionContext;
  /** Input matched no shape or could not be parsed (→ on_error). */
  error?: string;
}

/** /tmp, /private/tmp and $TMPDIR (plus its /private form on macOS). */
export function defaultTempDirs(): string[] {
  const dirs = ['/tmp', '/private/tmp', os.tmpdir(), process.env.TMPDIR].filter((d): d is string => !!d);
  return [...new Set(dirs.flatMap(d => (d.startsWith('/var/') ? [d, `/private${d}`] : [d])))];
}

const GLOBAL_SECRETS = SECRET_PATTERNS.map(r => new RegExp(r.source, r.flags.includes('g') ? r.flags : `${r.flags}g`));

/** Masks secret_added patterns and caps at MAX_COMMAND_CHARS. */
export function displayCommand(text: string): string {
  const masked = GLOBAL_SECRETS.reduce((t, r) => t.replace(r, '[secret]'), text);
  return masked.length > MAX_COMMAND_CHARS ? `${masked.slice(0, MAX_COMMAND_CHARS - 1)}…` : masked;
}

export async function assessCommands(input: unknown, o: CommandsOptions): Promise<CommandsResult> {
  const entries = normaliseCommands(input);
  if (!entries) return { command: UNPARSED_COMMANDS, error: 'run_commands input matches no known shape' };
  const command = displayCommand(entries.map(entryText).join('; '));
  const tempDirs = o.tempDirs ?? defaultTempDirs();
  let pieces;
  try {
    pieces = parseEntries(entries, { cwd: o.workspaceRoot, home: o.homeDir, tmpdir: process.env.TMPDIR ?? os.tmpdir() });
  } catch (e) {
    if (e instanceof ParseError) return { command, error: `could not parse the command: ${e.message}` };
    throw e;
  }
  const a = analyze(pieces, { workspaceRoot: o.workspaceRoot, homeDir: o.homeDir, tempDirs, trustedCommands: o.trustedCommands });
  const { changes, findings } = await gatherTargets(a.targets, a.discards, {
    workspaceRoot: o.workspaceRoot, tempDirs, budgetMs: o.budgetMs, gitTimeoutMs: o.gitTimeoutMs,
  });
  return {
    command,
    action: {
      workspaceRoot: o.workspaceRoot, homeDir: o.homeDir, pluginDir: o.pluginDir, codeownersGlobs: o.codeownersGlobs, changes,
      command: { findings: [...a.findings, ...findings], pieces: a.pieces, skipped: a.skipped, errors: a.errors },
    },
  };
}
