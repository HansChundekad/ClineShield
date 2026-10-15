# ClineShield — Spec & Roadmap

**Source of truth** for what ClineShield does and will do. Change a feature here first; tick boxes in the same
commit as the work. `PROGRESS.md` is the frozen 1.x build log.

**Legend:** `[x]` done and tested · `[ ]` not done · ⛔ owner approval needed before starting

**Rules**
1. A feature's checklist is its definition of done. Tick only what is implemented **and** tested.
2. If the work shows the spec is wrong, fix the spec in the same commit.
3. [Open decisions](#open-decisions) are the owner's call. Don't pick silently.
4. The `metrics.json` schema (`clineshield/src/types/metrics.ts`) is fixed; changing it is an open decision.

---

## What ClineShield is

A **Cline plugin** that checks every action Cline takes (file edits, deletes, shell commands) *before* it runs,
scores its risk with a configurable rubric, and responds in three tiers: **allow**, **ask the user**, or
**block with a reason** (Cline sees why and keeps working). Everything is logged to `.cline-shield/metrics.json`.
An **optional VS Code extension** reads that log and shows live dashboards (sidebar, change map, LLM explanations).

- **Runs in:** Cline CLI, Cline SDK, Kanban. **Not:** Cline inside VS Code/JetBrains (no plugin support there yet),
  Cline Desktop (plugin hooks don't fire, [cline#14593](https://github.com/cline/cline/issues/14593)).
- **Install:** `cline plugin install https://github.com/HansChundekad/ClineShield`. Works with zero config.

```
Cline agent loop
  ├─ beforeTool ──▶ Risk rubric ──▶ allow | ask user | skip + reason
  ├─ tool runs
  └─ afterTool  ──▶ record outcome · post-edit checks ──▶ feedback to Cline
         └──▶ .cline-shield/metrics.json ──▶ /clineshield (terminal) · VS Code extension (optional)
```

---

## 1.x — VS Code extension + hook files (shipped v0.1.0, being replaced)

- [x] No-Nuke guard: blocked TS/JS patches deleting > 3 functions or > 75 % changed (patch-relative)
- [x] Sanity checks: prettier → eslint → tsc after edits, errors fed back to Cline, max 3 retries
- [x] Rules-based risk score 0–100 (8 rules, `rulesEngine.ts`)
- [x] Gemini explanation for medium/high risk edits
- [x] `.cline-shield.yml` config, metrics log, sidebar, change map, status bar, demo tooling, 101 tests

**Why it's replaced:** current Cline runs hook files through its SDK, where a block (`cancel`) ends the whole task
and the model never sees why ([cline#14697](https://github.com/cline/cline/issues/14697)); tool names also changed.

---

## 2.0 — Cline plugin

### Done

#### Plugin package & install
- [x] `AgentPlugin` in `clineshield/src/plugin/`; root `package.json` `cline.plugins` points at it (Decision 5)
- [x] `setup()` synchronous and fast; every hook error caught and logged, never crashes the run
- [ ] Manual: `cline plugin install` from git works on a clean folder; `cline doctor` lists it

#### Session identity & metrics writer
- [x] Session id from `ctx.session.sessionId` (fallback UUID); writes the `session-start` marker
- [x] Writes through the existing `appendEvent()`; events validated against `metrics.ts`
- [x] Cross-process lock on `metrics.json` (Decision 6) — 4 processes × 25 events, all kept

#### Action tiers (allow · ask · block)
The mechanism every rule uses. Today it is driven by the 1.x size rules; the Risk rubric replaces the scoring.
- [x] Allow → `edit-allowed`. Ask → `policy: { autoApprove: false }` + reason via `appendContext`; outcome recorded as
  `edit-approval` (Decision 2). Block → `{ skip: true, reason }` → `edit-blocked`; the task continues
- [x] Patch parser + `editor` adapter as pure modules (`plugin/patch/`), reusable for in-memory apply
- [x] Interim scoring: 1.x size rules, TS/JS only, thresholds in `EDIT_SIZE_THRESHOLDS` (Decision 4)
- [x] < 200 ms on 20,000-line patches; unit tests at every tier boundary
- [ ] Manual: how the CLI shows the approval prompt and the reason (headless runs deny — tested)

#### Risk scoring after edits
- [x] `afterTool` scores each successful edit with `computeRiskScore()` and writes `risk-assessed` (lands with PR #18)
- Interim: TS/JS only, protected paths hard-coded (`DEFAULT_PROTECTED_PATHS`), sanity assumed passed. Replaced by the Risk rubric

#### Dashboards follow plugin sessions
- [x] Sidebar, change map and status bar show every session started since VS Code opened, incl. parallel ones (Decision 7)
- [ ] Manual: one real CLI session in `test-workspace/` with the sidebar open

#### CI
- [x] GitHub Actions runs `npm ci && npm test` on every push and PR (`.github/workflows/ci.yml`)

### Next

#### Risk rubric
One scoring system for **every** Cline action, in **any language**. Each category that fires adds points; the
total (0–100) picks the tier; the reason lists the categories that fired and how to make the action safer.
Edits are measured against the **real file**: in `beforeTool` the file is still unchanged on disk, so the
rubric reads it, applies Cline's change in memory, and compares. Nothing is written until the decision is made.

| Group | Categories | Applies to |
|---|---|---|
| Size | share of the original file removed or rewritten · lines removed · files touched in one action | edits |
| File operations | file deleted · existing file fully overwritten · file moved/renamed · path outside the workspace | edits |
| Sensitive files | protected paths (user list) · secrets (`.env*`, keys, certs) · CI config · infra (Dockerfile, Terraform, k8s) · DB migrations · dependency manifests & lockfiles · generated/vendored (`dist/`, `node_modules/`, `vendor/`) | edits |
| Weakening safety | tests deleted · tests skipped (`.skip`, `xit`, `@Ignore`, `pytest.mark.skip`, `t.Skip`) · checks disabled (`eslint-disable`, `@ts-ignore`, `# noqa`, `# type: ignore`, `//nolint`) | edits |
| Content | secret added (API key / token patterns in added lines) | edits |
| Code structure | functions, classes, methods or exports removed (tree-sitter, many languages) | edits |
| Commands | recursive delete (scored by target: workspace vs. outside/root) · git history rewrite (`reset --hard`, `push --force` but not `--force-with-lease`, `clean -fd`, `branch -D`) · pipe-to-shell (`curl … \| sh`) · `sudo` · destructive SQL (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`) · publish/deploy (`npm publish`, `docker push`, `terraform apply`, `kubectl apply`) | `run_commands` |
| Discounts | test files · new files that only add code | edits |

- [ ] Rubric engine: categories → points → capped score → tier; extends `rulesEngine.ts`, one engine for before and after the action
- [ ] Edits measured against the real file via in-memory apply; multi-file actions score each file, worst file decides
- [ ] Every category except code structure works on paths, lines and text patterns, so it runs on any language and file type
- [ ] Language pattern packs for "tests skipped" and "checks disabled" (JS/TS, Python, Go, Java, Rust, Ruby to start)
- [ ] Code structure via tree-sitter: loaded lazily, skipped when the language is unsupported or the time budget is tight
- [ ] Commands parsed (`&&`, `;`, `|`, `sudo`, quoting) before matching, not raw substring checks
- [ ] Reason text names the top categories and a safer alternative; same text goes to Cline and the logs
- [ ] `risk-assessed` `reasons[]` carries the fired categories; `structuralChangePercent` becomes file-relative (same field)
- [ ] Whole rubric < 200 ms per action (target), well inside the 3 s hook limit
- [ ] Replaces the interim 1.x size rules and the hard-coded protected paths; closes Decision 8
- [ ] Unit tests per category, plus: small edit to a big file allowed, full rewrite blocked, file delete, multi-file patch,
  non-JS files, unreadable file (falls back to patch-only measures), `rm -rf node_modules` vs `rm -rf /`

#### Rubric configuration
Zero config works (`balanced` preset). Teams commit a project file; individuals can set personal defaults.
- [ ] Reads `.cline-shield.yml` (project, meant to be committed) and `~/.cline-shield.yml` (personal); project wins
- [ ] `preset: relaxed | balanced | strict` (default `balanced`: asks more often than it blocks)
- [ ] Override tier cut-offs, any category's points, `off`, or `block` (always block when it fires)
- [ ] Per-folder overrides by glob (e.g. strict on `src/auth/**`, relaxed on `tests/**`)
- [ ] Custom rules: match a path, content or command pattern → points + message
- [ ] Validated against an allowlist; bad values fall back to defaults with a warning; regex length capped
- [ ] Re-read when the file changes; `.cline-shield.example.yml` documents every key
- [ ] No API keys in this file (the LLM key lives in the VS Code extension)

```yaml
preset: balanced
cutoffs: { ask: 40, block: 70 }
categories:
  ci_config: 40
  generated_files: off
  secret_added: block
paths:
  "src/auth/**": { preset: strict }
  "tests/**":    { preset: relaxed }
custom_rules:
  - { match: path, pattern: "billing/**", points: 40, message: "Billing code: ask first" }
```

#### Post-edit checks (time-budgeted)
After an edit, run the project's checkers and feed errors back to Cline, without ever hitting the 3 s hook limit.
- [ ] Checkers configurable per file glob (any language: e.g. `ruff`, `go vet`); default prettier → eslint → tsc for TS/JS
- [ ] Feedback via `appendContext` ("Attempt X/N", output, fix-only instruction); stop after `max_retries`, per task + file
- [ ] Warm checkers in the background; hard 2.5 s budget; late results delivered on the next hook call (Decision 3)
- [ ] Writes `sanity-passed` / `sanity-failed`; result feeds the rubric's after-edit score
- [ ] Unit tests with fake checkers: pass, fail, slow → deferred

#### Terminal visibility (`/clineshield`)
- [ ] Slash command (`"commands"` capability) prints this session's allowed / asked / blocked counts and riskiest files
- [ ] Never throws; clear message when there are no events; unit test against a fixture `metrics.json`
- [ ] Manual: does the CLI show a block reason to the user, or only to the model? Record here

#### VS Code extension (optional dashboard)
- [ ] Shows `edit-approval` outcomes and rubric categories
- [ ] No longer sets env vars for hooks; works when no plugin has run yet
- [ ] Opt-in LLM explanation: off by default, own Gemini key in SecretStorage ("Set/Clear Gemini API Key"),
  secrets stripped before sending, `gemini_api_key` in YAML ignored with a warning, plugin writes the diff sidecar

#### Retire 1.x hooks
- [ ] Remove `clineshield/hooks/`, root and `test-workspace/` `.clinerules/hooks/`, and hook-only env-var code in `configLoader.ts`

#### Evaluation ⛔
- [ ] 20–30 tasks in `test-workspace/`, labelled safe/destructive in advance, approved by the owner with a budget
- [ ] Report: destructive actions attempted / caught, false positives (safe actions asked or blocked), time added (median, p95)
- [ ] Raw results committed; README numbers are exactly what the run produced

#### README (last)
- [ ] One-line install, architecture diagram, rubric + config guide, eval results, CI badge, "what's next"

### Later
- `/clineshield init` and `/clineshield preset <name>` (edit the config file; check how the CLI passes command arguments first)
- LLM providers beyond Gemini: VS Code model API (needs Copilot), OpenAI-compatible endpoints (OpenRouter, local Ollama)
- LLM explanations for CLI-only users (plugin-side, key from an env var)
- Session-level signals (e.g. the same file churned many times)

---

## Open decisions

| # | Question | Status |
|---|---|---|
| 1 | How to record command blocks/asks in `metrics.json` (reuse edit events with the command as `file`, or a new event type) | open |
| 3 | Record post-edit checks that miss the time budget? (new event type) | open |
| 8 | 1.x port gaps: file deletes not evaluated; pure additions scored like rewrites | open → fixed by Risk rubric |
| 9 | Rubric defaults: points per category and `balanced` cut-offs (`ask: 40, block: 70` proposed) | open → tune with the eval |

**Decided**
- **2** — Ask-tier outcome: new `edit-approval` event (`file, structuralChangePercent, functionsDeleted, exportsDeleted, reason, approved`), written in `afterTool`; `approved: false` on the runtime's denial error (incl. headless).
- **4** — Interim edit thresholds hard-coded in `EDIT_SIZE_THRESHOLDS`; default preset `balanced` (2026-10-15).
- **5** — Plugin lives in `clineshield/src/plugin/`; minimal root `package.json` lists it (git install reads only the root manifest; `.ts` loads via jiti).
- **6** — `metrics.json.lock` in `appendEvent()`: exclusive create, stale after 5 s, write without it after 1 s wait.
- **7** — Dashboards show every session whose `session-start` is after extension activation, plus the extension's own id.
- **10** — Config model: committed project `.cline-shield.yml` + optional `~/.cline-shield.yml`, project wins; slash commands are shortcuts only (2026-10-15).

---

## Appendix — Cline platform facts (SDK source, `main`, 2026-10-14)

| Fact | Source |
|---|---|
| `beforeTool` returns `{ skip, reason }` (skip one call; reason reaches the model), `{ stop }` (end run), `{ policy }` (`autoApprove: false` → ask user), `{ input }`, `{ appendContext }` | `sdk/packages/shared/src/agent.ts`, `sdk/packages/agents/src/agent-runtime.ts` |
| `afterTool` gets `result`, `durationMs`; returns `{ result }`, `{ appendContext }`, `{ stop }` | same |
| `appendContext` is shown to the model as `<hook_context>` on its next request | `agent-runtime.ts` |
| Ask with no approval callback (headless) **denies**; a denial becomes a skip, `afterTool` sees `isError` with `TOOL_REJECTION_SUFFIX` | `agent-runtime.ts` L2432–2483, L2547, L2592; `shared/src/llms/tools.ts` L104 |
| Plugin hooks time out after **3000 ms** (no override); a throw or timeout is swallowed, so `beforeTool` fails **open** | `core/src/extensions/plugin/plugin-sandbox.ts`, `plugin-registry.ts` |
| `setup(api, ctx)`: `ctx.session.sessionId`, `ctx.workspaceInfo.rootPath`, `ctx.cwd`; hook snapshots lack the session id | `shared/src/extensions/contribution-registry.ts` L113–114, L165, L177, L206 |
| One worker process per session, so plugin and extension write from different processes | `plugin-registry.ts` `startWorkerCopy` |
| Git install clones the repo, `npm install --omit=dev` at root, loads root `package.json` `cline.plugins`; no subdirectory syntax, only `@ref` | `core/src/services/plugin-install.ts` |
| `.ts` entries load via jiti, so relative TS imports work without a build | `plugin-sandbox.ts`, `plugin-module-import.ts` |
| Plugins can add slash commands (`"commands"`, `api.registerCommand`) | [plugin reference](https://github.com/cline/cline/blob/main/.agents/skills/cline-sdk/references/plugins/REFERENCE.md) |
| Plugins load from `<workspace>/.cline/plugins/` or `~/.cline/plugins/`; template: `sdk/examples/plugins/gitignore-read-files-guard.ts` | [docs](https://docs.cline.bot/customization/plugins) |
