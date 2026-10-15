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
The mechanism every rule uses. Driven by the Risk rubric.
- [x] Allow → `edit-allowed`. Ask → `policy: { autoApprove: false }` + reason via `appendContext`; outcome recorded as
  `edit-approval` (Decision 2). Block → `{ skip: true, reason }` → `edit-blocked`; the task continues
- [x] Patch parser + `editor` adapter as pure modules (`plugin/patch/`), reusable for in-memory apply
- [x] ~~Interim scoring: 1.x size rules, TS/JS only, thresholds in `EDIT_SIZE_THRESHOLDS` (Decision 4)~~ Replaced by the Risk rubric (①)
- [x] < 200 ms on 20,000-line patches; unit tests at every tier boundary
- [ ] Manual: how the CLI shows the approval prompt and the reason (headless runs deny — tested)

#### Risk scoring after edits
- [x] `afterTool` scores each successful edit with `computeRiskScore()` and writes `risk-assessed` (lands with PR #18)
- `risk-assessed` now comes from the Risk rubric (①): every file type, `reasons[]` = fired categories, `level` from the file's cut-offs. Sanity checks are still assumed passed

#### Dashboards follow plugin sessions
- [x] Sidebar, change map and status bar show every session started since VS Code opened, incl. parallel ones (Decision 7)
- [ ] Manual: one real CLI session in `test-workspace/` with the sidebar open

#### CI
- [x] GitHub Actions runs `npm ci && npm test` on every push and PR (`.github/workflows/ci.yml`)

### Next

#### Risk rubric
One scoring system for **every** Cline action (edits, deletes, moves, commands), in **any language**. Each category
that fires adds points; the capped total (0–100) picks the tier against the preset's cut-offs. **Hard rules** block
whatever the total, also in observe mode. Edits are measured against the **real file**: in `beforeTool` the file is
still unchanged, so the rubric reads it, applies Cline's change in memory and compares. Nothing is written until the decision is made.
Designed with the owner 2026-10-15; points are starting values, tuned by the eval (Decision 9).

**Cut-offs (ask / block):** relaxed 60 / 90 · **balanced 40 / 70** (default) · strict 25 / 50. Multi-file action:
each file scored, worst file decides, `files_touched` adds to it, a hard rule on any file blocks the whole action.
**Risk groups:** per file, each group counts only its biggest finding (the rest are listed with 0 points). Groups:
lost code (`rewrite_share`, `lines_removed`, `functions_removed`, `exports_removed`) · scope · file ops · unrecoverable
(`uncommitted_lost`) · location (sensitive files, `manifest`, `generated`) · weakening safety · content · custom rules.
**Block rule:** hard rules and categories set to `block` always block. Otherwise relaxed and balanced block only when
the score reaches the block cut-off **and** two or more groups score; strict blocks at the cut-off alone. The file's
effective preset (per-folder `paths` preset wins) decides.

**Check kinds.** *Hard*: always block, no config can turn it off. *Critical*: if the check itself crashes → `on_error`.
*Signal*: if it crashes → skipped and logged. *Log-only*: recorded in `reasons[]` with 0 points (description says what
it would add); promoted to points only if the eval shows value. PR column = delivery order (see checklist).

| Category (`id`) | Points | Kind | PR |
|---|---|---|---|
| **Hard rules** | | | |
| `self_protection` — edit/command touching `.cline-shield.yml`, `~/.cline-shield.yml`, `.cline-shield/`, the plugin install dir | block | hard | ① |
| `placeholder` — "rest of code unchanged" / "existing code here" style lines in an edit to an existing file; `TODO: implement` or a stub body (`pass`, `...`, `throw new Error("not implemented")`, `todo!()`, `panic("TODO")`) added in a hunk that removed ≥ 3 real lines. New files never fire | block | hard | ① |
| `secret_added` — API key / token / private-key patterns in added lines | block | hard | ① |
| `rm_outside` — recursive delete outside the workspace or on `/`, `~` | block | hard | ② |
| **Size** (patch-only fallback for huge/unreadable files) | | | |
| `rewrite_share` — share of original file removed or rewritten (file ≥ 20 lines) | ≥ 40 %: 25 · ≥ 75 %: 50 | signal | ① |
| `lines_removed` | > 100: 15 · > 300: 30 | signal | ① |
| `files_touched` — files in one action | > 5: 15 · > 15: 30 | signal | ① |
| `deletion_heavy` — removed ≥ 4× added and ≥ 30 lines | (20) | log-only | ① |
| **File operations** | | | |
| `file_deleted` · `move_overwrites` (move/rename onto an existing file) | 35 · 40 | critical | ① |
| `uncommitted_lost` — delete, rewrite or move of a file with uncommitted changes (`git status`, cached per action) | +30 | critical | ① |
| `outside_workspace` — path (or symlink target) outside the workspace | 50 | critical | ① |
| **Sensitive files** | | | |
| `secrets_file` (`.env*`, keys, certs) · `ci_config` · `infra` (Dockerfile, Terraform, k8s) · `migration` | 45 · 35 · 30 · 30 | critical | ① |
| `protected_path` — config `protected_paths` + CODEOWNERS entries (read once per session) | 30 | critical | ① |
| `gitignore_changed` · `gitignore_unignores_secrets` (`!.env`, `.env`/`*.key` line removed) | 15 · 60 | critical | ① |
| `manifest` (dependency manifests, lockfiles) · `generated` (`dist/`, `node_modules/`, `vendor/`) | 15 · 20 | signal | ① |
| **Weakening safety** (pattern packs: JS/TS, Python, Go, Java, Rust, Ruby) | | | |
| `tests_deleted` · `tests_skipped` · `checks_disabled` | 40 · 30 · 20 | signal | ① |
| `assertions_weakened` (removed, or `toBe` → `toBeDefined` style) · `expected_changed` (values in assert lines) | 30 · 25 | signal | ① |
| `test_and_source` — test + source changed in one action · more if the last test run in the session failed | 15 · +25 | signal | ① · ④ |
| **Content** (added lines only) | | | |
| `security_weakened` (`rejectUnauthorized: false`, CORS `*`, `eval` / `new Function`, shell-mode child processes, `dangerouslySetInnerHTML`, CSRF off) | 40 | signal | ① |
| `auth_removed` (auth middleware, guards, permission checks) · `validation_removed` · `sql_string_built` | 45 · 40 · 40 | signal | ① |
| `new_domain` — URL host not already in the file and not in `trusted_domains` | 20 | signal | ① |
| `empty_catch` · `commented_out_block` | 10 · 10 | signal | ① |
| **Code structure** (per-language patterns; tree-sitter later) | | | |
| `functions_removed` (functions, classes, methods) | 10 each, max 40 | signal | ① |
| `exports_removed` (removed or renamed) | 20 each, max 40 | signal | ① |
| `signature_changed` · `env_key_renamed` | (15) · (20) | log-only | ① |
| **Commands** (parsed: `&&` `;` `\|` `\|\|`, `sudo`, `VAR=x cmd`, one level of `bash -c`; quotes, heredocs, comments masked) | | | |
| `rm_recursive` in workspace (`node_modules`, `dist`, build dirs = 0) | 20 | critical | ② |
| `discards_work` (`reset --hard`, `clean -fd`, `checkout -- .`, `restore .`) | 50 dirty tree · 10 clean | critical | ② |
| `history_rewrite` (`push --force` but not `--force-with-lease`, `branch -D`) | 50 | critical | ② |
| `pipe_to_shell` · `sudo` · `destructive_sql` (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`) · `publish` (`npm publish`, `docker push`, `terraform apply`, `kubectl apply`) | 45 · 40 · 50 · 60 | critical | ② |
| `chmod_broad` (`777`, `-R`) | 30 | signal | ② |
| `secret_exfil` — reads a secrets file and makes a network call in the same action | 70 | critical | ② |
| File-touching commands (`rm`, `mv`, `cp`, `sed -i`, `>`, `truncate`) run their targets through the path categories above | — | — | ② |
| **Dependencies** (npm + PyPI; manifest edits **and** `npm install x` / `pip install x`) | | | |
| `dep_added` · `dep_unpinned` (`*`, `latest`, no version) · `dep_downgrade` | 10 · 15 · 20 | signal | ③ |
| `dep_missing` — not in the registry (hallucinated) | 80 | signal | ③ |
| `dep_low_downloads` (< 1,000/week, npm only) · `dep_typosquat` (edit distance ≤ 2 from bundled top-5k list) · `dep_install_scripts` | 40 · 50 · 30 | signal | ③ |
| `dep_new_registry` (`.npmrc`, `--registry`, `--index-url`) | 45 | critical | ③ |
| `dep_unverified` — registry slow/offline (800 ms cap, cached per session); scoped/private-registry packages skipped | 10 | signal | ③ |
| **Session** (in-memory per session) | | | |
| `edit_loop` (same file ≥ 5× in 10 min) · `unread_file` · `manual_edit_overwritten` · `session_churn` (> 1,000 changed lines) · `stable_file` (no commits 6+ months) | (15) · (10) · (35) · (15) · (10) | log-only | ④ |
| **Discount** | | | |
| `test_file` — applies to size/scope signals only, never to the Weakening-safety group | −10 | — | ① |

**Reasons.** Cline gets what happened, the top 3 categories and one fixed "safer alternative" sentence per category,
**never points or cut-offs** (so it can't learn to slip under them). Block adds: "Don't retry the same change in
smaller pieces to get around this." After 3 blocks on the same file in one task: "Stop and ask the user how to
proceed." Ask adds: "If the user says no, don't retry; ask what they want." Points, totals and cut-offs go to the logs
and `/clineshield why`.

**Failure and time.** Unreadable tool input or a rubric-wide crash → `on_error` (default `ask`). Headless runs: ask =
deny with a logged reason, never a hang. Internal deadline 2 s (Cline's 3 s timeout fails **open**); order: hard and
critical path/pattern checks (no I/O) → file read + in-memory apply → `git status` (300 ms cap) → registry (800 ms cap).
Deadline hit before critical checks finish → `on_error`; later → remaining signals logged "skipped: time".

**Edge cases.** Binary (null byte in first 8 KB): path and file-op checks only. File > 2 MB or unreadable, or patch
doesn't match: patch-only measures (no ask for a non-matching patch, the tool will fail anyway). Renames: both paths
checked. CRLF normalised. Parallel tool calls scored independently.

**Logging.** Edits keep `edit-allowed` / `edit-approval` / `edit-blocked` (`structuralChangePercent` becomes
file-relative, same field) and `risk-assessed` after a successful edit (`reasons[]` = fired categories, `level` from
cut-offs: below ask = low, ask–block = medium, ≥ block = high). Commands use the new **`command-assessed`** event
(Decision 1), written when score > 0 or tier ≠ allow.

- [x] ① Rubric engine: categories → points → capped score → tier; one engine for before and after the action; replaces the interim 1.x size rules and `DEFAULT_PROTECTED_PATHS`; closes Decision 8
- [x] ① Edits measured against the real file via in-memory apply; patch-only fallback; worst file decides
- [x] ① Hard, File-operation, Sensitive-file, Size, Weakening-safety, Content and Code-structure categories with pattern packs for 6 languages
- [x] ① Check kinds enforced: a crashing critical check → `on_error`, a crashing signal → skipped and logged (test per kind)
- [x] ① 2 s internal deadline with the check order above; < 200 ms typical per action
- [x] ① Reason text as above; same text to Cline and logs; points only in logs
- [x] ① Unit tests per category, plus: small edit to a big file allowed, full rewrite asked (balanced) / blocked (strict), placeholder rewrite blocked, file delete with uncommitted changes, multi-file patch, non-JS files, binary, unreadable file
- [ ] ② `run_commands` input normalised (strings and `{command, args}`, all SDK union shapes); parser above; command categories; `command-assessed` event; `rm -rf node_modules` vs `rm -rf /` tests
- [ ] ③ Dependency categories; registry lookups with cap, cache and `offline: true`; bundled top-5k lists; tests with a fake registry
- [ ] ④ Session state store (test-run outcomes, edit history, reads); `test_and_source` +25; log-only session signals
- [ ] Manual: real CLI session in `test-workspace/` hitting allow, ask and block

#### Rubric configuration
Zero config works (`balanced`). The only config file is `~/.cline-shield.yml` (Decision 10); a `.cline-shield.yml`
inside a repo is never read, so a cloned repo can't change anything. Hard rules can't be configured. Ships with PR ①.

- [x] Reads only `~/.cline-shield.yml` (a project file has no effect, no warning); re-read when it changes (mtime check per action)
- [x] `mode: enforce | observe` (observe = score and log asks/blocks; hard rules still block); `preset: relaxed | balanced | strict`
- [x] `on_error: ask | allow` (default `ask`); `allow` is logged to stderr at first use; shown in the extension (VS Code extension feature)
- [x] Override `cutoffs`, any category's points, `off`, or `block`; `protected_paths`; `trusted_commands` (exact match per parsed command piece, never scored); `trusted_domains`; `offline` (`trusted_commands` and `offline` are validated now and take effect with ② and ③)
- [x] Per-folder overrides by glob, first match wins (preset, cut-offs, categories); apply in every repo
- [x] Custom rules: `match: path | content | command`, pattern, `points` or `block`, `message` (`command` rules apply from ②)
- [x] Validated against an allowlist: unknown key ignored, bad value → that key's default, unparseable file → skipped; all with a warning to stderr, kept for `/clineshield` (Terminal visibility), never in Cline's context
- [x] Regex patterns capped at 200 chars; a quantifier on a group (`(…)+`, `(?:…)*`, `(…){n}`) rejected; content rules test the first 500 chars of each line
- [x] `js-yaml` (already a dependency of the extension; no install scripts) added to root `package.json` dependencies; CI checks `npm install --omit=dev` from a clean clone loads the plugin
- [x] `.cline-shield.example.yml` documents every key; no API keys in this file (the LLM key lives in the VS Code extension)
- Default `protected_paths` (when the file doesn't set it): `src/auth/**`, `src/config/**`, `src/middleware/**`, `auth/**`, `config/**`.

```yaml
mode: enforce          # enforce | observe
preset: balanced       # relaxed | balanced | strict
on_error: ask          # ask | allow
offline: false         # true = no registry lookups
cutoffs: { ask: 40, block: 70 }
categories:            # points | off | block
  ci_config: 40
  generated: off
protected_paths: ["src/payments/**"]
trusted_commands: ["npm test", "make build"]
trusted_domains: ["api.mycompany.com"]
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
- [ ] `/clineshield why`: the last ask/block in full (every category, points, total, cut-off)
- [ ] Shows config warnings and an `on_error: allow` notice
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
- Code structure via tree-sitter (WASM `web-tree-sitter` + ~6 grammars, ~10 MB; native bindings ruled out: need a compiler on install). Only if the eval shows patterns miss real deletions
- Promote log-only signals to points when the eval shows they help
- Project config (`.cline-shield.yml` in a repo), tighten-only: a repo can add protection but never loosen it.

---

## Open decisions

| # | Question | Status |
|---|---|---|
| 3 | Record post-edit checks that miss the time budget? (new event type) | open |
| 9 | Rubric defaults: starting points and cut-offs set in Risk rubric (2026-10-15) | open → tune with the eval |

**Decided**
- **1** — Commands get a new `command-assessed` event (`command, tier, score, reasons, approved?`) added to `metrics.ts`; the extension learns it (2026-10-15).
- **2** — Ask-tier outcome: new `edit-approval` event (`file, structuralChangePercent, functionsDeleted, exportsDeleted, reason, approved`), written in `afterTool`; `approved: false` on the runtime's denial error (incl. headless).
- **4** — Interim edit thresholds hard-coded in `EDIT_SIZE_THRESHOLDS`; default preset `balanced` (2026-10-15).
- **5** — Plugin lives in `clineshield/src/plugin/`; minimal root `package.json` lists it (git install reads only the root manifest; `.ts` loads via jiti).
- **6** — `metrics.json.lock` in `appendEvent()`: exclusive create, stale after 5 s, write without it after 1 s wait.
- **8** — 1.x port gaps (file deletes not evaluated; pure additions scored like rewrites): closed by Risk rubric ① (deletes scored as `file_deleted`; new files never score size).
- **7** — Dashboards show every session whose `session-start` is after extension activation, plus the extension's own id.
- **10** — Config: only `~/.cline-shield.yml`; project files are not read (2026-10-15).

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
