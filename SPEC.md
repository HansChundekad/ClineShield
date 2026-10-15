# ClineShield — Spec & Roadmap

> **This file is the source of truth** for what ClineShield does and what it is going to do.
> If you want to change a feature, change it here first. If you finish a feature, tick it here
> in the same commit. `PROGRESS.md` is the frozen build log of 1.x and is no longer updated.

**Status legend:** `[x]` done and verified · `[~]` in progress · `[ ]` not started · ⛔ needs owner approval before starting

**Rules for whoever (human or AI) is working from this file**
1. Read the feature section before starting it. Its *Acceptance* list is the definition of done.
2. Tick a box only when the behaviour is implemented **and** tested (unit test, or the manual check named in the item).
3. If the work reveals the spec is wrong, fix the spec in the same commit and say so in the commit message.
4. Anything listed under [Open decisions](#open-decisions) is the owner's call — do not pick an answer silently.
5. The `metrics.json` schema (`clineshield/src/types/metrics.ts`) is fixed. Any change to it is an open decision.

---

## Part 1 — ClineShield 1.x: VS Code extension + Cline hook files (shipped, v0.1.0)

**What it is:** a VS Code extension plus two bash hook scripts (`PreToolUse`, `PostToolUse`) that the
user copies into `.clinerules/hooks/`. Cline runs the hooks around every tool call; the hooks write
events to `.cline-shield/metrics.json`; the extension watches that file and renders dashboards.

```
Cline ──▶ PreToolUse (bash) ──▶ allow / cancel ──▶ tool runs ──▶ PostToolUse (bash)
              │                                                     │
              └────────────── append event ──▶ .cline-shield/metrics.json ◀── append event
                                                     │ (file watcher)
                               VS Code extension: sidebar · change map · status bar · Gemini
```

### Features

- [x] **No-Nuke edit guard** — before an `apply_patch` edit to a TS/JS file, parses the patch, counts deleted
  functions and the structural-change % (changed lines ÷ patch lines). Blocks the edit when
  deleted functions > `max_deleted_functions` (3), or when the patch is > `max_structural_change_lines` (10)
  lines **and** change % > `max_structural_change_percent` (75). Writes `edit-blocked` / `edit-allowed`.
  Also blocks `execute_command` calls containing `rm -rf /` or `sudo rm` (substring match; that tool name no
  longer exists in current Cline, so this check is dead — see below).
- [x] **Sanity checks with retry feedback** — after a file edit, runs `prettier --check` → `eslint` → `tsc --noEmit`
  (stop on first failure, `timeout_seconds` each). On failure, injects the tool output into Cline's context
  (`contextModification`, "Attempt X/3"); stops nagging after `max_retries`. Retry state is kept per task+file
  in `.cline-shield/retry-state.json`. Writes `sanity-passed` / `sanity-failed`.
- [x] **Rules-based risk scoring** — every edit gets a deterministic 0–100 score from 8 rules
  (protected path +30, structural change +25/+40, deleted functions +20/+35, sanity failed +20,
  diff > 200 lines +15, test file −10). Levels: low 0–30, medium 31–60, high 61–100. Writes `risk-assessed`.
  Logic lives in `rulesEngine.ts` (unit-tested); the hook carries a bash port of it.
- [x] **LLM risk explanation (Gemini)** — for medium/high risk edits, the extension sends the diff and post-edit
  file to Gemini 2.5 Flash for a 2–3 sentence explanation. The rules engine owns the score; the LLM only explains.
  Skipped entirely when no API key is configured. Rate-limited (6 s between calls). Writes `llm-analysis`.
- [x] **YAML config** — `.cline-shield.yml` in the workspace root (template: `.cline-shield.example.yml`) with
  `no-nuke`, `sanity`, `risk.protected_paths` and a top-level `gemini_api_key`. The extension reads it on
  activation and exposes it to the hooks as `CLINESHIELD_*` env vars. "ClineShield: Reload Configuration" re-reads it.
- [x] **Metrics log** — `.cline-shield/metrics.json`, a JSON array of typed events (schema in
  `src/types/metrics.ts`), appended with atomic temp-file + rename writes and a per-process write queue.
  Each extension activation creates a session ID (UUID) passed to hooks via `CLINESHIELD_SESSION_ID`.
- [x] **Metrics sidebar** — activity-bar webview with live session stats (blocked, allowed, sanity passed/failed,
  avg retries) and a "most recent edit" panel with risk badge and Gemini explanation.
- [x] **Change Map** — tree view of every file Cline touched this session, coloured by worst risk level,
  with edit counts; click to open the file.
- [x] **Status bar item** — 🛡️ ClineShield with the session ID in its tooltip.
- [x] **Demo tooling** — "ClineShield: Generate Test Metrics" command, `test-workspace/` demo project
  (`test-workspace/DEMO.md`), Gemini smoke test (`npm run smoke:phase6`).
- [x] **Unit tests** — 101 Jest tests across 5 suites (rules engine, LLM trigger, metrics reader/writer, AST analyzer prototype).
- **Cancelled:** "Generate Hooks" command (copy hook scripts into `.clinerules/hooks/`). Superseded by Part 2.

### Why 1.x is out of date (verified against Cline source, 2026-10-14)

- Cline's VS Code extension (v4.1.x) now runs on the Cline SDK; hook files are bridged through
  `apps/vscode/src/sdk/hooks-adapter.ts`.
- A `PreToolUse` `cancel: true` is now mapped to `stop: true`, which **aborts the whole task**, and the model
  never sees the reason ([cline#14697](https://github.com/cline/cline/issues/14697)). No-Nuke used to reject one
  edit and tell Cline to try a smaller one; now it kills the run.
- SDK tool names changed (`read_files`, `editor`, `apply_patch`, `run_commands`). The 1.x `write_to_file` and
  `execute_command` branches no longer match anything.
- `PostToolUse` `contextModification` still works (mapped to `appendContext`).
- Plugins are now Cline's primary extension mechanism.

---

## Part 2 — ClineShield 2.0: Cline Plugin (SDK migration)

**Goal:** ClineShield becomes a single Cline plugin (`AgentPlugin`) that guards edits and shell commands
*inside* Cline's agent loop, gives the model actionable feedback instead of killing the task, and keeps
writing the same `metrics.json` so the existing VS Code dashboards keep working.

**Supported surfaces:** Cline CLI, Cline SDK, Kanban.
**Not supported:** Cline inside VS Code / JetBrains (Cline does not load plugins there yet — owner decision:
plugin only, no hook-file fallback). Cline Desktop loads plugins but does not fire their hooks
([cline#14593](https://github.com/cline/cline/issues/14593)); revisit when that is fixed.

```
Cline CLI / SDK agent loop
  ├─ beforeTool ──▶ Edit Size Policy · Shell Command Guard ──▶ allow | require approval | skip+reason
  ├─ tool runs
  └─ afterTool  ──▶ Sanity checks (time-budgeted) · Risk scoring ──▶ appendContext feedback
         │
         └──▶ appendEvent() ──▶ .cline-shield/metrics.json ──▶ VS Code extension (sidebar · change map · Gemini)
```

### Platform facts this design depends on (from Cline SDK source, `main`, 2026-10-14)

| Fact | Source |
|---|---|
| `beforeTool` may return `{ skip, reason }` (skip one call; reason goes to the model as a tool error), `{ stop }` (end the run), `{ policy }` (e.g. `autoApprove: false` → ask the user), `{ input }`, `{ appendContext }` | `sdk/packages/shared/src/agent.ts` (`AgentBeforeToolResult`), `sdk/packages/agents/src/agent-runtime.ts` |
| `afterTool` receives `result` and `durationMs`; may return `{ result }` (replace output), `{ appendContext }`, `{ stop }` | same files (`AgentAfterToolResult`) |
| `appendContext` text is injected as a `<hook_context>` message the model sees on its next request | `agent-runtime.ts` |
| Requiring approval with no approval callback configured (headless runs) **denies** the call | `agent-runtime.ts` `requestToolApproval` |
| A denied approval becomes a skip: `afterTool` still runs, with `result.isError` and output `{ error: "<reason> -- " + TOOL_REJECTION_SUFFIX }`. A `beforeTool` `appendContext` is queued even when the call is then denied or skipped | `agent-runtime.ts` L2432–2483 (hook loop, approval), L2547 (skip → error result), L2592 (afterTool); `TOOL_REJECTION_SUFFIX` in `sdk/packages/shared/src/llms/tools.ts` L104 |
| Plugin hooks time out after **3000 ms** (host option, no env override) | `sdk/packages/core/src/extensions/plugin/plugin-sandbox.ts` |
| A hook that throws or times out is swallowed (returns `undefined`): `beforeTool` fails **open**, `afterTool` feedback is lost silently | `sdk/packages/core/src/extensions/plugin/plugin-registry.ts` |
| Plugins load from `<workspace>/.cline/plugins/` or `~/.cline/plugins/`; installed with `cline plugin install <git url | npm | local path>`; single-file URL installs may only import Node builtins and `@cline/*` | [docs: Plugins](https://docs.cline.bot/customization/plugins), [Writing Plugins](https://docs.cline.bot/sdk/guides/writing-plugins) |
| Closest upstream template: `sdk/examples/plugins/gitignore-read-files-guard.ts` | [examples](https://github.com/cline/cline/tree/main/sdk/examples/plugins) |
| `setup(api, ctx)` gets the host session id as `ctx.session.sessionId`, the workspace root as `ctx.workspaceInfo.rootPath` and the session cwd as `ctx.cwd`. Hook snapshots carry only `agentId` / `conversationId` / `runId`, not the session id | `sdk/packages/shared/src/extensions/contribution-registry.ts` L113–114, L165, L177, L206; `agent.ts` `AgentRuntimeStateSnapshot` |
| Each session gets its own worker-process copy of the plugin, so the plugin and the VS Code extension write `metrics.json` from different processes | `plugin-registry.ts` `loadForSession` → `startWorkerCopy` (`transport: "worker"`) |
| A git install clones the whole repo, runs `npm install --omit=dev --omit=peer` at the repo root, and loads the entry files listed in the root `package.json` `cline.plugins` (paths relative to the repo root; with no list it scans the whole tree). There is no subdirectory syntax, only `@ref` | `sdk/packages/core/src/services/plugin-install.ts` `installGitPackage`, `installPackageDependencies`, `collectPluginEntries`, `splitGitRef` |
| `.ts` entries are loaded through jiti (`^2.7.0`), so relative TypeScript imports such as `../metrics/writer` work at runtime without a build step | `plugin-sandbox.ts` (bootstrap script, `createJiti`); `plugin-loader.ts` → `plugin-module-import.ts` |

### Features

#### Plugin package & install
Ships ClineShield as a Cline plugin package that a user installs with one command.
- [x] Plugin package in the repo with a `package.json` `cline.plugins` entry and `capabilities: ["hooks"]` (root `package.json` → `clineshield/src/plugin/index.ts`; see Open decision #5)
- [x] Exports an `AgentPlugin`; `setup()` is synchronous and fast (no heavy work before the first model call)
- [ ] Installs locally: `cline plugin install <path>` (or a `.cline/plugins/` link) loads it in `test-workspace/`; `cline doctor` lists it
- [ ] Installs from git with one command (`cline plugin install https://github.com/HansChundekad/ClineShield…`) — verified on a clean machine/dir
- [x] Any hook error is caught inside the plugin, logged to stderr, and never crashes the run

#### Session identity
Every event a run writes carries the same session ID, without the VS Code extension creating it.
- [x] Session ID taken from the Cline runtime/plugin context (fallback: UUID generated in `setup()`). Source: `ctx.session.sessionId` in `setup()`
- [x] Sidebar's "this session" view works with plugin-written events (see Dashboard compatibility). The plugin writes the same `session-start` marker as `extension.ts` (an `edit-allowed` event with `data.file: "session-start"`). The dashboards show **every session that started since the extension activated**: all session ids whose `session-start` timestamp is ≥ activation time, plus the extension's own id (Open decision #7). Parallel sessions (e.g. CLI + Kanban) are merged; the set resets on reload. Logic: `selectVisibleSessionIds()` / `filterVisibleEvents()` in `src/metrics/sessions.ts`, unit-tested in `src/metrics/__tests__/sessions.test.ts`

#### Metrics writer (shared contract)
The plugin writes the exact same events as 1.x, using the existing writer.
- [x] Plugin imports `appendEvent()` from `src/metrics/writer.ts` — no second writer, no `jq`
- [x] Every event validates against `src/types/metrics.ts` (unit test)
- [x] Writes are atomic and queued; concurrent plugin + extension writes do not corrupt the file (covered by `scripts/benchmark-atomic-writes.js` or a test). Covered by `src/plugin/__tests__/concurrentWrites.test.ts`: 4 real processes × 25 events, all 100 kept. Cross-process writes are serialised by a `metrics.json.lock` file in `appendEvent()` (Open decision #6)

#### Edit Size Policy (three tiers: allow · require approval · block)
Replaces No-Nuke. Measures each `apply_patch` / `editor` edit to a TS/JS file and responds in proportion.
- **Small** → allowed silently, writes `edit-allowed`.
- **Medium** → user must approve (`policy: { autoApprove: false }`) and Cline is told why via `appendContext`.
- **Destructive** → skipped with `{ skip: true, reason }`; Cline sees the reason, the task continues, writes `edit-blocked`.
- After the user decides on a medium edit, `afterTool` writes one `edit-approval` per file with `approved` (Open decision #2).
- Code: `clineshield/src/plugin/patch/` (pure patch parser + `editor` adapter, reusable for an in-memory apply),
  `clineshield/src/plugin/editPolicy/measure.ts` (1.x measurement port), `editPolicy/policy.ts` (tiers, messages), hooks in `plugin/index.ts`.
- Measurement notes: structural change % = changed ÷ (changed + context) lines, floored, per file (1.x). An `editor`
  replacement is line-diffed so its unchanged lines count as context. New files (`*** Add File`, `editor` create) are
  always allowed. `*** Delete File` is not evaluated yet (Open decision #8). Multi-file patches: each TS/JS file is
  evaluated, the worst tier decides the call, one event per evaluated file.
- [x] Measures deleted functions and structural change % for `apply_patch` (port of the 1.x patch parser) and `editor` edits
- [ ] Tier thresholds come from config; proposed defaults — block: > 3 deleted functions, or > 75 % change on a > 10-line patch (1.x behaviour); approve: 2–3 deleted functions, or 40–75 % change on a > 10-line patch. Defaults hard-coded in `EDIT_SIZE_THRESHOLDS` (`editPolicy/policy.ts`, Open decision #4); reading them from config comes with the Configuration feature
- [x] Destructive edits are skipped, not stopped: the run continues and the model receives the reason
- [ ] Medium edits trigger an approval prompt in the CLI; in headless runs they are denied (documented). Headless denial is implemented, tested (`approved: false`) and documented here and in the README; the CLI prompt needs a manual check with the Cline CLI
- [x] Non-TS/JS files and non-edit tools pass through untouched
- [x] Finishes well inside the 3 s hook limit (target < 200 ms) — tests assert < 200 ms for 15,000- and 20,000-line patches
- [x] Unit tests for each tier boundary and for the patch parser

#### Shell Command Guard
Inspects `run_commands` calls and stops dangerous commands before they run, with the same three tiers.
- [ ] Parses each command (handles `&&`, `;`, `|`, `sudo`, quoted args) instead of matching raw strings
- [ ] Guards `rm -rf`, `git reset --hard`, `git push --force` / `-f`; `--force-with-lease` is allowed
- [ ] Proposed tiers — block: `rm -rf` on `/`, `~`, `$HOME`, `..` or anything outside the workspace; `git push --force` to `main`/`master`. Approve: `rm -rf` inside the workspace, `git reset --hard`, `git push --force` to other branches. Allow: everything else
- [ ] Blocked commands are skipped with a reason that tells Cline the safer alternative
- [ ] Unit tests including tricky cases (`rm -rf node_modules` vs `rm -rf /`, `rm -r -f`, `git push origin +main`)
- [ ] How blocked/approved commands are recorded in metrics — see [Open decisions](#open-decisions)

#### Post-edit sanity checks (time-budgeted)
Same prettier → eslint → tsc chain and retry feedback as 1.x, redesigned so it never silently dies on the 3 s hook timeout.
- [ ] Runs in `afterTool` for successful edits to TS/JS files; feedback via `appendContext` ("Attempt X/N", tool output, fix-only instruction)
- [ ] Retry counting per task+file, stop feedback after `max_retries` (1.x semantics)
- [ ] Checkers kept warm from `setup()` (e.g. in-memory TypeScript language service, ESLint instance) so typical checks finish < 2 s
- [ ] Hard internal budget (~2.5 s): `afterTool` always returns before the 3 s limit
- [ ] If checks are still running at the budget, the result is delivered on the next hook call (`beforeTool`/`afterTool` `appendContext`) instead of being lost
- [ ] Known gap documented: if Cline makes no further tool call, a late result can only be recorded, not shown to the model
- [ ] Writes `sanity-passed` / `sanity-failed` exactly as 1.x
- [ ] Unit tests with fake checkers (pass, fail, slow → deferred)

#### Risk scoring
Every allowed edit gets the same deterministic score as 1.x.
- `afterTool` scores each successful `apply_patch` / `editor` edit to a TS/JS file (same file rule as the Edit Size
  Policy) and writes one `risk-assessed` per file, workspace-relative path. Calls that come back with `isError`
  (approval denied, blocked/skipped, or the edit itself failed) are not scored. Code: `recordRisk()` in `plugin/index.ts`.
- Inputs: the `beforeTool` measurement for that `toolCallId` (cached, removed in `afterTool`), else measured again from
  the input. Diff size = that file's changed (`+`/`-`) lines (1.x counted the whole patch). New files score on path and
  size only (structural change and deleted functions treated as 0, like 1.x `write_to_file`).
- Sanity checks are not built in the plugin yet, so every edit is scored as "sanity not failed" (`sanityPassed: true`);
  wire in the real outcome with Post-edit sanity checks.
- [x] Plugin calls `computeRiskScore()` from `rulesEngine.ts` directly (the bash port is retired). Tests: `src/plugin/__tests__/riskScoring.test.ts`
- [x] Writes `risk-assessed` in the existing shape
- [ ] Protected paths come from config. Until the Configuration feature, the 1.x defaults are hard-coded in one constant, `DEFAULT_PROTECTED_PATHS` (`rulesEngine.ts`): `src/config/`, `src/auth/`, `src/middleware/`, `auth/`, `config/` (prefix) and `.env`, `.env.local`, `.env.production`, `.env.development` (exact file name)
- [x] Existing rules-engine tests keep passing

#### Configuration
`.cline-shield.yml` keeps working, read by the plugin itself.
- [ ] Plugin reads `.cline-shield.yml` from the workspace root at `setup()` (no env-var bridge)
- [ ] New keys for tier thresholds and the shell guard, with safe defaults when absent
- [ ] Values validated against an allowlist; bad values fall back to defaults with a warning
- [ ] `.cline-shield.example.yml` documents every key

#### Dashboard compatibility (VS Code extension)
The extension becomes a viewer: open the workspace in VS Code, run Cline from the CLI, watch the dashboards. (Owner confirmed 2026-10-14: keep the extension as a viewer; do not drop it.)
- [x] Sidebar, Change Map and status bar update live from plugin-written events — all three filter through `filterVisibleEvents()` / `selectVisibleSessionIds()` (sessions started since activation + the extension's own session, Open decision #7); existing watchers handle both `onDidCreate` and `onDidChange`. Status bar tooltip shows how many Cline sessions are being followed. Live behaviour with a real CLI run is the manual check below
- [ ] Gemini explanation still triggers for medium/high `risk-assessed` events (diff sidecar written by the plugin)
- [ ] Extension no longer needs to set env vars for hooks; it still works when no plugin has run yet
- [ ] Manual check: one real CLI session in `test-workspace/` with the sidebar open

#### Terminal visibility (Cline CLI)
CLI users without VS Code can see what ClineShield did this session without leaving the terminal. (Owner agreed 2026-10-14.)
- [ ] Plugin declares the `"commands"` capability (alongside `"hooks"`) and registers `/clineshield` with `api.registerCommand` in `setup()`
- [ ] `/clineshield` prints this session's stats (edits allowed / held for approval / blocked, sanity passed / failed, avg retries) read from `metrics.json` filtered on the plugin's session id
- [ ] Also prints the riskiest files this session (top 5 by worst `risk-assessed` score, with level)
- [ ] Prints a clear one-liner when there are no events yet; never throws (errors caught like the hooks)
- [ ] Unit test: command handler output against a fixture `metrics.json`
- [ ] Manual check (CLI): how the CLI displays a `beforeTool` `skip` reason — does the user see it, or only the model? Record the answer here
- [ ] Manual check (CLI): how the CLI shows the approval prompt and whether the `appendContext` note explaining *why* is visible to the user. Record the answer here

#### LLM risk explanation (opt-in)
For medium/high risk edits, the VS Code extension asks an LLM for a 2–3 sentence plain-English explanation
and shows it in the sidebar. The rules engine still owns the score; the LLM only explains. The call stays in
the extension (not the plugin): it is a display feature, and plugin hooks have a 3 s budget. Cline's plugin
API gives plugins no access to the user's Cline model or credentials, so ClineShield uses its own key.
- [ ] **Off by default.** Enabled only by an explicit opt-in (setting or first-run prompt) that states the diff and file contents are sent to the provider
- [ ] **One provider in 2.0: bring-your-own Gemini key** (Gemini 2.5 Flash, existing `llmAnalyzer.ts`)
- [ ] Key stored in VS Code SecretStorage via a "ClineShield: Set Gemini API Key" command (and a matching "Clear" command); never in YAML, settings.json or logs
- [ ] `gemini_api_key` in `.cline-shield.yml` is ignored and triggers a one-time warning pointing to the command
- [ ] Secrets stripped from the diff and file contents before sending (API keys, tokens, `.env`-style assignments); unit-tested
- [ ] Plugin writes the diff sidecar the extension reads (1.x behaviour); no LLM call happens in the plugin
- [ ] Extension works fully with the feature off or no key set (rules-only scoring); existing rate limit (6 s) kept
- [ ] README explains what is sent, to whom, and how to turn it off

Later (not in 2.0 — add a feature section here before building):
- VS Code Language Model API (`vscode.lm`) — no key; uses models other extensions register (in practice GitHub Copilot). Not usable by Claude Code-only users.
- OpenAI-compatible endpoint (base URL + model + key) — covers OpenRouter, local Ollama (free, nothing leaves the machine), and others.
- CLI-only users without VS Code: plugin-side explanation using a `CLINESHIELD_LLM_API_KEY` env var.

#### Automated tests & CI
- [ ] Unit tests for every new module (policy tiers, patch parser, command parser, sanity budget, config)
- [ ] Plugin-level tests: call `beforeTool` / `afterTool` with fake tool calls and assert results + metrics events
- [x] GitHub Actions workflow runs `npm ci && npm test` on every push and PR (Node 20) — `.github/workflows/ci.yml`
- [ ] CI badge in README

#### Evaluation ⛔ owner must approve the task set and budget before any run
A small, honest measurement of what ClineShield catches and costs.
- [ ] Task set of 20–30 prompts in `test-workspace/`, each labelled in advance as *safe* or *destructive* — reviewed by owner
- [ ] Script runs each task through the Cline CLI with ClineShield on and collects `metrics.json` + timings
- [ ] Reports: destructive edits attempted, destructive edits caught, safe edits wrongly blocked/held (false positives), time added by checks (median / p95 from `durationMs`)
- [ ] Raw results committed; numbers in the README are exactly what the run produced

#### Retire 1.x hook files
- [ ] Remove `clineshield/hooks/`, the repo-root `.clinerules/hooks/` and `test-workspace/.clinerules/hooks/` once the plugin reaches parity
- [ ] Remove env-var plumbing from `configLoader.ts` that only the hooks used

#### README & docs (final step)
- [ ] One-line install command
- [ ] Architecture diagram
- [ ] Eval results table
- [ ] "What's next" section: hybrid rules + LLM layer
- [ ] `test-workspace/DEMO.md` updated for the CLI flow

---

## Open decisions

| # | Question | Status |
|---|---|---|
| 1 | How to record shell-command blocks/approvals in `metrics.json` without changing the schema (or approve a schema change) | open |
| 2 | How to record medium-tier "approval required" outcomes (reuse `edit-allowed`/`edit-blocked` after the user decides, or new event type) | **decided 2026-10-14:** new event type `edit-approval`, `data: { file, structuralChangePercent, functionsDeleted, exportsDeleted, reason, approved }`, written in `afterTool` (matched by `toolCallId`) for edits `beforeTool` sent to approval. `approved` is false when the result is the runtime's approval-denied error (carries `TOOL_REJECTION_SUFFIX`; includes headless runs), true otherwise. Only schema change allowed for this feature. Implemented and tested; dashboard count comes later |
| 3 | Whether to record sanity checks that missed the time budget (would need a new event type) | open |
| 4 | Final tier thresholds for Edit Size Policy and Shell Command Guard (defaults above are proposals) | **decided 2026-10-14 (Edit Size Policy):** hard-code the proposed defaults now, in one constant (`EDIT_SIZE_THRESHOLDS`); configurable later. Shell Command Guard thresholds still open |
| 5 | Plugin package location: `clineshield/plugin/` inside the existing package, or a separate top-level package | **decided 2026-10-14:** plugin source in `clineshield/src/plugin/` (reuses `metrics/writer.ts` through a relative import), plus a minimal root `package.json` whose `cline.plugins` lists `./clineshield/src/plugin/index.ts`. Why: a git install has no subdirectory option, reads only the root `package.json` (`plugin-install.ts` `collectPluginEntries`), and loads `.ts` entries through jiti with no build step |
| 6 | Cross-process writes to `metrics.json` lost events (plugin worker vs. extension host, or two Cline sessions in the same folder): last rename wins | **decided 2026-10-14:** lock file in `appendEvent()` (`metrics.json.lock`, created exclusively, taken over after 5 s as stale, written without the lock after 1 s of waiting so hooks never block). Rejected: one file per session, because it changes the fixed `metrics.json` location contract and every reader; accepting the loss. Implemented and tested |
| 7 | Which sessions the VS Code dashboards show, now that plugin events carry the Cline session id instead of the extension's UUID | **decided 2026-10-14:** every session that started since the extension activated — session ids whose `session-start` marker timestamp is ≥ activation time, plus the extension's own session id (so "Generate Test Metrics" and `llm-analysis` events still show). Parallel sessions (CLI + Kanban) are merged; resets on reload. Sessions without a `session-start` marker, or started before activation, are hidden. Implemented in `src/metrics/sessions.ts` |
| 8 | Edit Size Policy gaps found while porting 1.x: (a) `*** Delete File` of a TS/JS file is not evaluated (1.x ignored it; the parser has no file contents); (b) the 1.x % rule treats pure additions the same as rewrites, so adding a new 11+ line function with little context is blocked (> 75 %) or held for approval | open |
