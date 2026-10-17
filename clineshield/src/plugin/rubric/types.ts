/**
 * types.ts
 *
 * Shared types for the Risk rubric (SPEC.md "Risk rubric"). Pure data.
 */

import type { FileOperation } from '../patch';

export type Tier = 'allow' | 'ask' | 'block';

/**
 * hard: always blocks, not configurable. critical: a crash in the check →
 * on_error. signal: a crash → skipped and logged. logOnly: recorded with 0 points.
 */
export type CheckKind = 'hard' | 'critical' | 'signal' | 'logOnly';

export type CategoryId =
  | 'self_protection' | 'placeholder' | 'secret_added'
  | 'rewrite_share' | 'lines_removed' | 'files_touched' | 'deletion_heavy'
  | 'file_deleted' | 'move_overwrites' | 'uncommitted_lost' | 'outside_workspace'
  | 'secrets_file' | 'ci_config' | 'infra' | 'migration' | 'protected_path'
  | 'gitignore_changed' | 'gitignore_unignores_secrets' | 'manifest' | 'generated'
  | 'tests_deleted' | 'tests_skipped' | 'checks_disabled' | 'assertions_weakened'
  | 'expected_changed' | 'test_and_source'
  | 'security_weakened' | 'auth_removed' | 'validation_removed' | 'sql_string_built'
  | 'new_domain' | 'empty_catch' | 'commented_out_block'
  | 'functions_removed' | 'exports_removed' | 'signature_changed' | 'env_key_renamed'
  | 'rm_outside' | 'rm_recursive' | 'discards_work' | 'history_rewrite' | 'pipe_to_shell' | 'sudo'
  | 'destructive_sql' | 'publish' | 'chmod_broad' | 'secret_exfil' | 'shell_edit' | 'unknown_target';

/** One file of an action, as the checks see it. */
export interface FileChange {
  /** Display path: workspace-relative POSIX when inside the workspace, else absolute. */
  path: string;
  absPath: string;
  kind: FileOperation['type'];
  /** Display path of a move/rename target. */
  moveTo?: string;
  op: FileOperation;
  /** File text before the action; undefined when missing, binary, > 2 MB, unreadable or gather timed out. */
  original?: string;
  originalLineCount?: number;
  /** undefined = unknown (not checked or timed out). */
  exists?: boolean;
  binary: boolean;
  /** Patch applies to `original`; undefined when `original` is unknown. */
  matched?: boolean;
  moveTargetExists?: boolean;
  /** path or moveTo (after resolving symlinks) is outside the workspace. */
  outsideWorkspace: boolean;
  /** File has uncommitted changes; undefined when git is unavailable. */
  gitDirty?: boolean;
  /** File is tracked by git; undefined when git is unavailable or timed out. */
  gitTracked?: boolean;
  /** Lines added / removed by this change (for a delete with a known original: every original line). */
  added: string[];
  removed: string[];
  /** Per-hunk view for checks that need locality. */
  hunks: Array<{ added: string[]; removed: string[] }>;
  /** Context lines in the patch (for the patch-only size fallback). */
  contextLines: number;
  isTest: boolean;
  /** Set when a shell command changes the file: the command form, e.g. "sed -i". */
  shellEdit?: string;
  /** Name-only shell overwrite (`cp`, `>` from an unknown source, `truncate`, `dd of=`): new content unknown. */
  overwrite?: boolean;
}

export interface ActionContext {
  workspaceRoot: string;
  homeDir: string;
  /** Directory the plugin is installed in (self-protection). */
  pluginDir: string;
  changes: FileChange[];
  /** CODEOWNERS path patterns as globs. */
  codeownersGlobs: string[];
  /** run_commands only: command-level findings, scored as one extra item (COMMAND_ITEM). */
  command?: CommandAssessment;
}

/** Command-level part of a run_commands action (rubric/commands). */
export interface CommandAssessment {
  findings: RawFinding[];
  /** Text of each parsed piece not skipped by trusted_commands (custom `match: command` rules test these). */
  pieces: string[];
  /** Signal detectors that crashed. */
  skipped: string[];
  /** Critical detectors that crashed (→ on_error). */
  errors: string[];
}

/** What a check reports; the engine turns weight into points. */
export interface RawFinding {
  category: CategoryId;
  /** 0..1 share of the category's max points (bands and per-unit counts). */
  weight: number;
  /** Human detail, e.g. "82% of the file rewritten". Shown to Cline and logs. */
  detail: string;
  /** Optional numbers the plugin copies into metrics events. */
  /** Points taken off after weighting (floor 0), e.g. a deleted file git can restore. */
  minus?: number;
  counts?: { functionsDeleted?: number; exportsDeleted?: number; structuralChangePercent?: number };
}

/** Per-file view of the config a check may need. */
export interface CheckOptions {
  protectedPaths: string[];
  trustedDomains: string[];
}

export interface Check {
  name: string;
  /** Crash behaviour: critical → on_error, signal → skipped. */
  kind: 'critical' | 'signal';
  /** Per-file checks get `change`; action checks (`perAction: true`) are called once with the first change. */
  perAction?: boolean;
  run(change: FileChange, action: ActionContext, options: CheckOptions): RawFinding[];
}
