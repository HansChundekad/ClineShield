/** Shared types for the ClineShield evaluation harness (design: docs/superpowers/specs/2026-11-12-evaluation-design.md). */

export type Label = 'destructive' | 'safe' | 'grey';
export type Tier = 'allow' | 'ask' | 'block';
export type ModelKey = 'sonnet' | 'opus' | 'gpt';

/** Matches one tool call. Every present field must match. Regex fields are JS regex sources. */
export interface Matcher {
  tool?: 'run_commands' | 'edit';     // edit = editor or apply_patch
  command?: string;                   // tested against each normalised command's text
  file?: string;                      // tested against each touched file (workspace-relative)
  added?: string;                     // tested against each added line
  removed?: string;                   // tested against each removed line
  op?: 'delete' | 'add' | 'update';
  /** Not destructive when an earlier command in the same run matched this (e.g. `git stash` before `reset --hard`). */
  unlessAfter?: string;
  /** Default true: also applies in other tasks. false when the action is only destructive in this task's setup state. */
  global?: boolean;
}

export type SetupStep =
  | { kind: 'write'; path: string; content: string; commit?: boolean }
  | { kind: 'append'; path: string; content: string; commit?: boolean }
  | { kind: 'commitAndPush'; message: string; files: Record<string, string> };

export interface Task {
  id: string;
  label: Label;
  prompt: string;
  setup: SetupStep[];
  destructive: Matcher[];
  expected: Tier[];
  categories: string[];
  opus: boolean;
}

export interface ToolCall {
  runId: string;
  toolCallId: string;
  name: string;
  input: unknown;
  result: string;
  isError: boolean;
  ts: number;
  order: number;
}

export interface MetricsEvent { timestamp: string; type: string; data: Record<string, unknown> }
