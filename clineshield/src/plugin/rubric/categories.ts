/**
 * categories.ts
 *
 * Default points, check kinds and fix sentences per category (SPEC.md
 * "Risk rubric" table). `max` is the category's top points; checks report a
 * 0..1 weight (bands, per-unit counts) and the engine multiplies. A config
 * points override replaces `max`, so bands scale with it.
 */

import type { CategoryId, CheckKind } from './types';

export type Group = 'hard' | 'size' | 'fileops' | 'sensitive' | 'weakening' | 'content' | 'structure';

export interface CategoryDef {
  max: number;
  kind: CheckKind;
  group: Group;
  /** One fixed "safer alternative" sentence shown to Cline. */
  fix: string;
}

export type Preset = 'relaxed' | 'balanced' | 'strict';
export interface Cutoffs { ask: number; block: number }

export const PRESET_CUTOFFS: Record<Preset, Cutoffs> = {
  relaxed: { ask: 60, block: 90 },
  balanced: { ask: 40, block: 70 },
  strict: { ask: 25, block: 50 },
};

/** Size/scope categories: the only ones the test-file discount reduces. */
export const SIZE_GROUP: ReadonlySet<CategoryId> = new Set(['rewrite_share', 'lines_removed', 'files_touched']);
export const TEST_FILE_DISCOUNT = 10;

const def = (max: number, kind: CheckKind, group: Group, fix: string): CategoryDef => ({ max, kind, group, fix });

export const CATEGORIES: Record<CategoryId, CategoryDef> = {
  self_protection: def(0, 'hard', 'hard', 'Do not change ClineShield files; ask the user to edit them by hand.'),
  placeholder: def(0, 'hard', 'hard', 'Write out the full code you are keeping, or change only the lines you need.'),
  secret_added: def(0, 'hard', 'hard', 'Read the secret from an environment variable or secrets manager instead of writing it into the file.'),
  rewrite_share: def(50, 'signal', 'size', 'Change one function or block at a time and keep the rest of the file as it is.'),
  lines_removed: def(30, 'signal', 'size', 'Remove less code per edit, and only what the task requires.'),
  files_touched: def(30, 'signal', 'size', 'Split the change into smaller actions that touch fewer files.'),
  deletion_heavy: def(20, 'logOnly', 'size', 'Delete only what the task requires.'),
  file_deleted: def(35, 'critical', 'fileops', 'Only delete files the task requires; confirm with the user if unsure.'),
  move_overwrites: def(40, 'critical', 'fileops', 'Move to a path that does not exist yet, or ask the user before replacing that file.'),
  uncommitted_lost: def(30, 'critical', 'fileops', 'Ask the user to commit or stash their changes first.'),
  outside_workspace: def(50, 'critical', 'fileops', 'Keep changes inside the project folder.'),
  secrets_file: def(45, 'critical', 'sensitive', 'Leave secrets files to the user unless the task is explicitly about them.'),
  ci_config: def(35, 'critical', 'sensitive', 'Change CI configuration only when the task asks for it.'),
  infra: def(30, 'critical', 'sensitive', 'Change infrastructure files only when the task asks for it.'),
  migration: def(30, 'critical', 'sensitive', 'Add a new migration instead of editing an existing one.'),
  protected_path: def(30, 'critical', 'sensitive', 'This path is protected; keep the change minimal and explain why it is needed.'),
  gitignore_changed: def(15, 'critical', 'sensitive', 'Change .gitignore only when the task asks for it.'),
  gitignore_unignores_secrets: def(60, 'critical', 'sensitive', 'Keep secrets files ignored by git.'),
  manifest: def(15, 'signal', 'sensitive', 'Change dependencies only when the task needs it.'),
  generated: def(20, 'signal', 'sensitive', 'Edit the source that generates this file instead.'),
  tests_deleted: def(40, 'signal', 'weakening', 'Keep existing tests; fix the code so they pass.'),
  tests_skipped: def(30, 'signal', 'weakening', 'Do not skip tests; fix the code so they pass.'),
  checks_disabled: def(20, 'signal', 'weakening', 'Fix the warning instead of disabling the check.'),
  assertions_weakened: def(30, 'signal', 'weakening', 'Keep assertions as strict as they were; fix the code instead.'),
  expected_changed: def(25, 'signal', 'weakening', 'Change expected values only if the requirement changed; otherwise fix the code.'),
  test_and_source: def(15, 'signal', 'weakening', 'Change tests and source in separate steps so each can be checked.'),
  security_weakened: def(40, 'signal', 'content', 'Keep the security setting on and solve the problem another way.'),
  auth_removed: def(45, 'signal', 'content', 'Keep the authentication or permission check in place.'),
  validation_removed: def(40, 'signal', 'content', 'Keep the input validation in place.'),
  sql_string_built: def(40, 'signal', 'content', 'Use parameterised queries instead of building SQL from strings.'),
  new_domain: def(20, 'signal', 'content', 'Only call services the project already uses, or ask the user first.'),
  empty_catch: def(10, 'signal', 'content', 'Handle or log the error instead of ignoring it.'),
  commented_out_block: def(10, 'signal', 'content', 'Delete unused code instead of commenting it out.'),
  functions_removed: def(40, 'signal', 'structure', 'Do not delete functions or classes the task does not require.'),
  exports_removed: def(40, 'signal', 'structure', 'Keep exported names; other code may depend on them.'),
  signature_changed: def(15, 'logOnly', 'structure', 'Keep public signatures unless the task requires a change.'),
  env_key_renamed: def(20, 'logOnly', 'structure', 'Keep environment variable and config key names unless the task requires a rename.'),
};
