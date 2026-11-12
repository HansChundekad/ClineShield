# Risk rubric ④ — session memory (basic) — design

Date: 2026-11-11 · Branch: `phase-9/session-signals` · SPEC: "Risk rubric" ④ row and checklist

## Why

Today every action is scored alone. ClineShield forgets that a test just failed or that Cline has edited the same
file six times. ④ gives the plugin a small memory for the session so the rubric can use it. The owner's call:
**keep it basic and reliable; finish it**. Clever cases are out of scope.

## Goals

1. An in-memory session store in the plugin worker with three things: last known test-run outcome, edit history
   per file, files Cline has read.
2. `test_and_source`: 15 normally; **30 when the last known test run in this session failed** (owner: a noted bump,
   not an ask on its own — 30 stays under the balanced and relaxed ask cut-offs; strict, at 25, still asks).
3. Three log-only signals (0 points, in `reasons[]`, description says what it would add):
   - `edit_loop` (15): this edit would be the 5th or more successful edit of the same file within 10 minutes.
   - `unread_file` (10): Cline edits a file that already exists and that it has not read, created or edited this session.
   - `session_churn` (15): changed lines this session (including this action) go over 1,000.

## Non-goals (owner decision, moved to the SPEC roadmap)

- `manual_edit_overwritten` — telling user edits apart from formatters is where false alarms come from.
- `stable_file` — needs git history on every action.
- Reads through shell (`cat`, `head`…); edits through shell commands (`sed -i`, `>`) do not enter edit history or churn.
- Persisting the store. Losing it on restart is fine. Nothing new is written to disk; metrics.json schema unchanged.

## Anti-goals

- A crash in any session logic must never block or change the decision beyond skipping that signal (logged).
- An unclear test outcome must never count as failed.
- Asked or blocked actions (they never ran) must never count as edits.
- Points and cut-offs never reach Cline.

## Verified SDK facts (Cline CLI 3.0.74, `@cline/core` / `@cline/agents` dist)

- `run_commands` input normalises to a list of entries (`normaliseCommands` already handles all shapes). Each entry
  runs as its own shell, all entries in parallel. afterTool `result.output` is an array in entry order:
  `{ query, result, success, error? }`. Non-zero exit → `success: false`, `error: "Command exited with code N"`.
  Signals, timeouts, spawn failures and detached ("still running") commands have other texts → unknown.
- Skipped calls (our ask/block, approval denied) still reach afterTool with `isError: true`. `isError` is set only
  when the tool's `execute` throws or the call was skipped; `run_commands` catches every entry's failure itself
  (`Promise.all` of per-entry try/catch), so a failing test arrives as `isError: false` with that entry `success: false`.
- `read_files` input: `{files:[{path,start_line?,end_line?}]}` plus legacy shapes (string, array, `paths`,
  `file_paths`, `file_path`/`filePath`). afterTool `result.output` is an array in request order with `success` per file.
  `editor` has no view command; `search_codebase` is not a read.

## Decisions

### Test run
An entry of a `run_commands` request is a **test run** only when, after parsing it with the existing command parser
(`parseEntries`), its top-level pieces are zero or more `cd` pieces followed by exactly one test command, with no
pipe in or out. Test commands: `npm|pnpm|yarn|bun test`, `npm|pnpm|yarn|bun run test` (and `test:*` scripts),
`npx|pnpm exec|yarn` + `jest|vitest|mocha`, bare `jest|vitest|mocha|pytest`, `python|python3 -m pytest|unittest`,
`go test`, `cargo test`, `dotnet test`, `mvn test`, `gradle test`/`./gradlew test`, `rspec`, `make test`.
Anything else (chains with `&&` to other commands, pipes, `;` lists, parse errors) is not a test run → ignored.

Outcome per test entry: `success: true` → passed; `error` matching `^Command exited with code [1-9]\d*` → failed;
anything else → unknown (ignored). One request with several test entries: failed if any failed, else passed if any
passed, else no change. The store keeps only the **latest known outcome**; a pass clears a failure. The whole tool
result being `isError` (skipped / denied) → no change.

### Read
A path counts as read after a successful `read_files` entry (whole file or a range). A file Cline created or edited
successfully this session also counts. Paths are compared as display paths (workspace-relative POSIX, else absolute),
the same form `FileChange.path` uses.

### Edit history and churn
Recorded in afterTool for `apply_patch` / `editor` only when the result is not an error. Each file of the action gets
one timestamp; churn adds that file's `added.length + removed.length`. Line counts come from the scored change kept
with the beforeTool decision; if there is no decision (patch-only fallback path), from the changes built there.

### Deletes, moves, agents, unknowns (builder's calls, marked as such)
- A successful delete removes the path from the store. A successful move removes the source and records the target
  as known (read) with no edit history carried over.
- One store per plugin worker, shared by every agent in the session (teammates included): same workspace, same files.
- Unknowns never fire: `unread_file` needs `exists === true`; `session_churn` and `edit_loop` count only changes with
  known lines. The `session` check runs only for `apply_patch` / `editor` changes (skips `shellEdit` changes), so
  run_commands actions get only the `test_and_source` effect.

### Store bounds
At most 500 files tracked (oldest-touched dropped first, across reads and edits). Per file, at most 20 edit
timestamps and none older than 10 minutes are kept. Churn is one number.

### Scoring integration
- `ActionContext` gets an optional `session` view (last test failed? prior edits of a path in the window? read? churn
  so far?), built synchronously from the store in `decide()` right before `scoreAction`. No I/O, so negligible time.
- `test_and_source` (perAction, existing): weight `2` (30 points) when `session.lastTestFailed`, else 1. Detail text adds
  "after a failed test run". One finding → the per-group rule cannot drop the extra points. A points override scales
  both (setting × weight), same as other banded categories.
- New per-file signal check `session` emits `edit_loop`, `unread_file`, `session_churn` (once per action: only on the
  first change, so churn isn't listed per file). Categories: kind `logOnly`, group `null`, max 15/10/15, a fix
  sentence each. Log-only → engine forces 0 points; `off` drops them; config validation already accepts any
  non-hard category, so overrides and per-folder presets work unchanged.
- Check kind `signal`: a crash is skipped and logged by the existing engine path.
- run_commands actions also get the session view so `test_and_source` on shell-edited files sees it.

### Concurrency
JS in the worker is single-threaded; every store update is a synchronous block after any `await`, so parallel tool
calls cannot lose updates. Each toolCallId is recorded once (afterTool runs once per call).

### Visibility
Nothing new: log-only findings already flow into `reasons[]` with 0 points, so `/clineshield why` and the extension
show them like `deletion_heavy`.

## Changes after the first real-Cline check (2026-11-11, owner approved)

The real session showed Cline (Claude model) editing with two parallel `editor` calls, one file each, and reading
files with `cat`. So: `test_and_source` also pairs a source file with its matching test (same name stem) edited
within 10 minutes or still running (approved, not yet finished); terminal reads (`cat`/`head`/`tail`/`less`/`more`/
`bat`, literal names, successful entries) count as reads. 

Second check (2026-11-12): pairing and reads worked, but Cline ran `npm test 2>&1; echo "EXIT_CODE=$?"`, so the
failed run stayed unknown (15, not 30). Owner approved: a test run followed by one `echo` of `$?` (one `$?`, nothing
else dynamic, no redirect) reads the suite's code from the printed last line, which must match the echo exactly; no
match → unknown (or failed if the entry itself exited non-zero, the `&&` case). Reading test tools' summary lines
when the code is hidden (`| tail`, `|| true`) goes to the roadmap.

## Tests (TDD)

- Store: test outcome failed → passed → cleared; unknown leaves state; bounds (501st file evicts oldest; 21st
  timestamp drops oldest; timestamps > 10 min pruned).
- Test-run classifier: each listed command; `cd x && npm test` yes; `npm run build && npm test`, `npm test | tail`,
  `npm test; echo` no; exit-code texts; timeout / signal / detached → unknown.
- `test_and_source`: 15 → 30 after a failed run → 15 after a pass; survives the group rule next to another weakening
  finding in the same file; points override scales.
- `edit_loop` at 4 prior edits (fires) and 3 (doesn't); 10-minute window edge.
- `unread_file`: existing unread file fires; read, created-earlier, edited-earlier, new file don't.
- `session_churn`: 1,000 total doesn't fire; 1,001 does.
- Plugin integration: afterTool with `isError` doesn't record edits; parallel afterTools all recorded; read_files
  partial failures; log-only reasons appear with 0 points in risk-assessed; `off` removes them.
- Timing: measure `decide()` with and without session view on a 500-file store; report numbers.

## SPEC changes in the same commit

- Tick ④ with the basic scope; `test_and_source` row: "15 · 30 after a failed test run" (SPEC said +25; owner chose +15 so it never asks alone on balanced).
- Session row lists only `edit_loop`, `unread_file`, `session_churn`; move `manual_edit_overwritten` and `stable_file`
  to the roadmap.
- Add the "Manual (date, CLI version, commit)" line after the owner's real-Cline check.

## Left to the builder

File layout (suggest `rubric/session.ts` for the store + classifier, `rubric/checks/session.ts`), exact detail
strings, fix sentences, helper names.
