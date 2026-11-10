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
  └─ afterTool  ──▶ record outcome · after-edit risk score
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
- [x] Manual (2026-11-08, CLI 3.0.73, `e7a0edd`): `cline plugin install` from git works on a clean folder; a session loads it and writes `session-start`. `cline doctor` has no plugin section, so it can't confirm an install

#### Session identity & metrics writer
- [x] Session id from `ctx.session.sessionId` (fallback UUID); writes the `session-start` marker
- [x] Writes through the existing `appendEvent()`; events validated against `metrics.ts`
- [x] Cross-process lock on `metrics.json` (Decision 6) — 4 processes × 25 events, all kept

#### Action tiers (allow · ask · block)
The mechanism every rule uses. Driven by the Risk rubric.
- [x] Allow → `edit-allowed`. Ask → `{ skip: true, reason }` telling Cline to ask the user in chat (see "Ask through the conversation"); outcome recorded as
  `edit-approval` (Decision 2). Block → `{ skip: true, reason }` → `edit-blocked`; the task continues
- [x] Patch parser + `editor` adapter as pure modules (`plugin/patch/`), reusable for in-memory apply
- [x] ~~Interim scoring: 1.x size rules, TS/JS only, thresholds in `EDIT_SIZE_THRESHOLDS` (Decision 4)~~ Replaced by the Risk rubric (①)
- [x] < 200 ms on 20,000-line patches; unit tests at every tier boundary
- [x] Manual (2026-10-15): with Cline's auto-approve all on, the CLI approves an ask without prompting (`approved: true`, no prompt); with it off, one-shot runs show `Approve "editor" <input> [y/N]` without ClineShield's reason. Blocks always apply. Fixed by "Ask through the conversation"
- Known limit (2026-11-08, CLI 3.0.73): in a one-shot run, 3 blocks in a row ended the run (`finishReason: aborted`, exit 0) at the default `--retries 3`; the same prompt with `--retries 10` completed. Blocks appear to count as consecutive mistakes. One run each; interactive mode not tested. Look at a fix after "Ask through the conversation"

#### Risk scoring after edits
- [x] `afterTool` scores each successful edit with `computeRiskScore()` and writes `risk-assessed` (lands with PR #18)
- `risk-assessed` now comes from the Risk rubric (①): every file type, `reasons[]` = fired categories, `level` follows the decision (②). Sanity checks are assumed passed (post-edit checks are out of 2.0, see Later)

#### Dashboards follow plugin sessions
- [x] Sidebar, change map and status bar show every session started since VS Code opened, incl. parallel ones (Decision 7)
- [x] Manual (2026-11-08, CLI 3.0.73, `e7a0edd`, owner confirmed by eye): one real CLI session with the sidebar open, in a standalone git repo. The sidebar showed the allowed and blocked edits and the most recent edit, and the change map showed the file
- [x] A folder nested in a git repo shows its sessions: the extension reads and watches the git root's `.cline-shield/metrics.json`, the same `git rev-parse --show-toplevel` lookup Cline uses (unit tests in `metricsRoot.test.ts`). Manual (2026-11-08, owner confirmed by eye): with `packages/app` open in a throwaway repo, the sidebar and change map showed the allowed and blocked edits from a real CLI session

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
lost code (`rewrite_share`, `lines_removed`, `functions_removed`, `exports_removed`) · scope · file ops (incl. `rm_recursive`,
`shell_edit`, `unknown_target`) · unrecoverable (`uncommitted_lost`, `discards_work`, `history_rewrite`) · location (sensitive
files, `generated`) · dependency (every `dep_*`, `manifest`; a manifest edit and an install command score alike) · weakening safety · content · privilege (`sudo`, `chmod_broad`) · external (`pipe_to_shell`,
`publish`, `destructive_sql`, `secret_exfil`) · custom rules.
**Commands:** all commands in one `run_commands` request are one action. Command findings form one item, `(command)`; each
file a command changes is an item like an edited file; worst item decides, a hard rule anywhere blocks the request.
`trusted_commands` pieces are skipped; `match: command` custom rules test each piece.
**Block rule:** hard rules and categories set to `block` always block. Otherwise relaxed and balanced block only when
the score reaches the block cut-off **and** two or more groups score; strict blocks at the cut-off alone. The file's
effective preset (per-folder `paths` preset wins) decides.
**Recoverability:** deleting, moving or ≥ 75 % rewriting an existing file git doesn't track counts as `uncommitted_lost`;
deleting or moving onto a tracked file with no uncommitted changes is −10 (git can restore it). Lost-code points stay.

**Check kinds.** *Hard*: always block, no config can turn it off. *Critical*: if the check itself crashes → `on_error`.
*Signal*: if it crashes → skipped and logged. *Log-only*: recorded in `reasons[]` with 0 points (description says what
it would add); promoted to points only if the eval shows value. PR column = delivery order (see checklist).

| Category (`id`) | Points | Kind | PR |
|---|---|---|---|
| **Hard rules** | | | |
| `self_protection` — edit/command touching `.cline-shield.yml`, `~/.cline-shield.yml`, `.cline-shield/`, the plugin install dir | block | hard | ① |
| `placeholder` — "rest of code unchanged" / "existing code here" style lines in an edit to an existing file; `TODO: implement` or a stub body (`pass`, `...`, `throw new Error("not implemented")`, `todo!()`, `panic("TODO")`) added in a hunk that removed ≥ 3 real lines. New files never fire | block | hard | ① |
| `secret_added` — API key / token / private-key patterns in added lines | block | hard | ① |
| `rm_outside` — recursive delete of `/`, `~`, `$HOME`, the project itself (`rm -rf .`, `*` at the root), a folder containing the project or home, or anything resolving outside the workspace; `/tmp`, `/private/tmp`, `$TMPDIR` exempt | block | hard | ② |
| **Size** (patch-only fallback for huge/unreadable files) | | | |
| `rewrite_share` — share of original file removed or rewritten (file ≥ 20 lines) | ≥ 40 %: 25 · ≥ 75 %: 50 | signal | ① |
| `lines_removed` | > 100: 15 · > 300: 30 | signal | ① |
| `files_touched` — files in one action | > 5: 15 · > 15: 30 | signal | ① |
| `deletion_heavy` — removed ≥ 4× added and ≥ 30 lines | (20) | log-only | ① |
| **File operations** | | | |
| `file_deleted` · `move_overwrites` (move/rename onto an existing file); −10 when the file is tracked and clean | 35 · 40 | critical | ① |
| `uncommitted_lost` — delete, rewrite (≥ 75 %) or move of a file with uncommitted changes or not tracked by git (`git diff HEAD` + `git ls-files`, once per action) | +30 | critical | ① |
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
| **Commands** (`run_commands`, all 9 input shapes, see Appendix. Parsed: split on `&&` `;` `\|` `\|\|` `&` newlines; `sudo` (scores `sudo`), `VAR=x`, `env`, `nohup`, `time` stripped; one level of `bash`/`sh`/`zsh -c` and `$(…)` / backtick / `<(…)` bodies unwrapped; `cd dir &&` tracked so relative paths resolve; quotes, heredocs, comments masked. A `{command, args}` entry is argv, no shell) | | | |
| `rm_recursive` in workspace (`node_modules`, `dist`, `build`, `out`, `.next`, `.nuxt`, `target`, `coverage`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.turbo`, `.cache`, `.parcel-cache` = 0, and not scored as file deletes); `find -delete` / `-exec rm` | 20 | critical | ② |
| `discards_work` (`reset --hard`, `clean -f`, `checkout -- <paths>` / `.`, `restore <paths>` without `--staged`); one `git status` (300 ms cap), unknown = dirty | 50 dirty tree · 10 clean | critical | ② |
| `history_rewrite` (`push --force` but not `--force-with-lease`, `branch -D`) | 50 | critical | ② |
| `pipe_to_shell` · `sudo` · `destructive_sql` (`DROP`, `TRUNCATE`, `DELETE` without `WHERE` given to `psql`/`mysql`/`sqlite3`…; `dropdb`, `prisma migrate reset`, `rails db:drop`) · `publish` (`npm`/`yarn`/`pnpm publish`, `docker push`, `terraform apply`/`destroy`, `kubectl apply`/`delete`, `cargo publish`, `twine upload`, `gem push`) | 45 · 40 · 50 · 60 | critical | ② |
| `chmod_broad` (`777`, `666`, `o+w`, `-R`) | 30 | signal | ② |
| `secret_exfil` — reads a secrets file and makes a network call (`curl`, `wget`, `nc`, `scp`) in the same request | 70 | critical | ② |
| `shell_edit` — any command that changes a file (forms below); fix: use the editor tool so the change can be reviewed | 15 | signal | ② |
| `unknown_target` — a file-changing command whose target contains `$VAR`, `$(…)` or backticks, follows `cd $VAR`, or comes from `xargs` | 40 | critical | ② |
| File-changing commands. **Full content known** (`cat > f <<EOF`, `tee f <<EOF`, `echo`/`printf` of literal text `> f`): a full-file replace scored against the real file with every edit check; `>> f` with known text: added lines (content checks apply). **Name only** (`sed -i`, `perl -i`, `rm`, `rmdir`, `unlink`, `mv`, `cp`, `truncate`, `dd of=`, `>` from an unknown source): path and file-op checks; an overwrite (`cp`, `>`, `truncate`, `dd`) counts as `move_overwrites` only on a git-tracked file (untracked ones are mostly logs and build output). Folders show as `dir/`. Temp dirs and `/dev/null`-style sinks skipped. No `edit-*` / `risk-assessed` events for shell edits | — | — | ② |
| **Dependencies** (npm + PyPI; manifest edits **and** `npm install x` / `pip install x`) | | | |
| `dep_missing` — definite 404 from the public registry (hallucinated); only packages not already in the manifest | 80 | signal | ③ |
| `dep_typosquat` — one edit (a neighbour swap counts as one) from the bundled top-5k list, name ≥ 5 chars, not on the list; no network. Measured: flags 2–3 % of legitimate packages ranked 5,001–8,000 (≤ 2 edits flagged about 6 %) | 50 | signal | ③ |
| `dep_install_scripts` (npm only, latest version) | 30 | signal | ③ |
| `dep_new_registry` (`.npmrc`, `.yarnrc[.yml]`, `bunfig.toml`, `pip.conf`, `uv.toml`, `pyproject.toml` sources, requirements `--index-url`, `--registry`, `--index-url`, `-i`, `npm`/`pip config set`, inline registry env vars; public registries excluded; logs show the host only) | 45 | critical | ③ |
| `dep_unverified` — registry slow or failing (800 ms cap, at most 20 lookups per action, cached per session) | 10 | signal | ③ |
| Manifests: `package.json`, `requirements*.txt`, `pyproject.toml` (PEP 621, dependency groups, Poetry). Commands: `npm`/`pnpm`/`yarn`/`bun` add or install, `pip install`, `python -m pip install`, `uv pip install`, `uv add`, `poetry add`, `pdm add`, `pipx install`. **Privacy:** a new package's name goes to public npm/PyPI unless it is scoped, `offline: true`, or a non-public default registry is configured (project, command folder or user `.npmrc`/`.yarnrc`/`bunfig.toml`/`pip.conf`/`uv.toml`, `pyproject.toml` sources, `requirements*.txt` indexes, `NPM_CONFIG_REGISTRY`, `PIP_INDEX_URL` and similar, re-read per action, or the command or file's own index). An unparseable manifest sends nothing | — | — | ③ |
| **Session** (in-memory per session) | | | |
| `edit_loop` (same file ≥ 5× in 10 min) · `unread_file` · `manual_edit_overwritten` · `session_churn` (> 1,000 changed lines) · `stable_file` (no commits 6+ months) | (15) · (10) · (35) · (15) · (10) | log-only | ④ |
| **Discount** | | | |
| `test_file` — applies to size/scope signals only, never to the Weakening-safety group | −10 | — | ① |

**Reasons.** Cline gets what happened, the top 3 categories and one fixed "safer alternative" sentence per category,
**never points or cut-offs** (so it can't learn to slip under them). Block adds: "Don't retry the same change in
smaller pieces to get around this." After 3 blocks on the same file in one task: "Stop and ask the user how to
proceed." Ask adds: "If the user says no, don't retry; ask what they want." Points, totals and cut-offs go to the logs
and `/clineshield why`.

**Failure and time.** Unreadable tool input (incl. `run_commands` input matching no shape, unbalanced quotes, a parser
crash) or a rubric-wide crash → `on_error` (default `ask`). Headless runs: ask =
deny with a logged reason, never a hang. Internal deadline 2 s (Cline's 3 s timeout fails **open**); order: hard and
critical path/pattern checks (no I/O) → file read + in-memory apply → `git status` (300 ms cap) → registry (800 ms cap).
Deadline hit before critical checks finish → `on_error`; later → remaining signals logged "skipped: time". The registry cap shrinks to fit: `min(800, 2000 − elapsed − 150)` ms; if the registry config can't be read in time, nothing is sent and the skip is logged.

**Edge cases.** Binary (null byte in first 8 KB): path and file-op checks only. File > 2 MB or unreadable, or patch
doesn't match: patch-only measures (no ask for a non-matching patch, the tool will fail anyway). Renames: both paths
checked. CRLF normalised. Parallel tool calls scored independently.

**Logging.** Edits keep `edit-allowed` / `edit-approval` / `edit-blocked` (`structuralChangePercent` becomes
file-relative, same field) and `risk-assessed` after a successful edit (`reasons[]` = fired categories). `level` follows
the decision: allow = low, ask = medium, block = high. Commands use the new **`command-assessed`** event (Decision 1), one
per `run_commands` request, written when score > 0 or tier ≠ allow: `command` (pieces joined, capped at 500 chars,
secrets masked with the `secret_added` patterns), `tier`, `score`, `reasons` (`{rule, points, description}`; file findings
name the file, e.g. "app.ts: 82% of the file rewritten"), `approved` (asked commands only, written in `afterTool`), `cutoffs`
(the deciding item's). `edit-blocked` and `edit-approval` also carry that file's `score`, `reasons` and `cutoffs` (for `/clineshield why`).

- [x] ① Rubric engine: categories → points → capped score → tier; one engine for before and after the action; replaces the interim 1.x size rules and `DEFAULT_PROTECTED_PATHS`; closes Decision 8
- [x] ① Edits measured against the real file via in-memory apply; patch-only fallback; worst file decides
- [x] ① Hard, File-operation, Sensitive-file, Size, Weakening-safety, Content and Code-structure categories with pattern packs for 6 languages
- [x] ① Check kinds enforced: a crashing critical check → `on_error`, a crashing signal → skipped and logged (test per kind)
- [x] ① 2 s internal deadline with the check order above; < 200 ms typical per action
- [x] ① Reason text as above; same text to Cline and logs; points only in logs
- [x] ① Unit tests per category, plus: small edit to a big file allowed, full rewrite asked (balanced) / blocked (strict), placeholder rewrite blocked, file delete with uncommitted changes, multi-file patch, non-JS files, binary, unreadable file
- [x] ② `run_commands` input normalised: all 9 SDK shapes, `{command, args}` as argv; no shape → `on_error`
- [x] ② Parser as above (no I/O); unbalanced quotes → `on_error`; quoted, heredoc and commented text never matches
- [x] ② Command categories incl. `rm_outside` temp exemption, `shell_edit`, `unknown_target`; one request = one action
- [x] ② Shell edits: full-content forms scored with every edit check against the real file; name-only forms with path and file-op checks
- [x] ② `trusted_commands` and `match: command` custom rules take effect
- [x] ② `command-assessed` event added to `metrics.ts`; `level` follows the decision (also for `risk-assessed`)
- [x] ② Tests: `rm -rf node_modules` allowed vs `rm -rf /` blocked, `/tmp` exemption, each shell-edit form, chains, pipes, `sudo`, `VAR=x`, `bash -c`, every input shape; < 200 ms typical per request (measured: median 10–15 ms, worst 23 ms on a git temp workspace)
- [x] ③ Dependency categories; registry lookups with cap, cache and `offline: true`; bundled top-5k lists (`clineshield/scripts/refresh-top-packages.js`, run by hand); tests with a fake registry
- [ ] ④ Session state store (test-run outcomes, edit history, reads); `test_and_source` +25; log-only session signals
- [ ] Manual: real CLI session in a disposable git repo hitting allow, ask and block
  - Allow and block recorded 2026-11-08 (CLI 3.0.73, `e7a0edd`, one-shot runs in a disposable git repo; ask not tested). Allow: small edit (`edit-allowed`, `risk-assessed` 0), `rm -rf node_modules` (no event). Block: placeholder and added-token edits (`edit-blocked`), `rm -rf` outside the workspace (`command-assessed`, `rm_outside`); nothing changed, Cline saw the reason, no points or cut-offs reached it. Commands matched the spec: chain and `bash -c` (`chmod_broad` 30, allow), pipe into `rm -rf` outside (block), `cat > new <<EOF` (`shell_edit` 15, allow), `cat > existing <<EOF` with a placeholder (block)

#### Rubric configuration
Zero config works (`balanced`). The only config file is `~/.cline-shield.yml` (Decision 10); a `.cline-shield.yml`
inside a repo is never read, so a cloned repo can't change anything. Hard rules can't be configured. Ships with PR ①.

- [x] Reads only `~/.cline-shield.yml` (a project file has no effect, no warning); re-read when it changes (mtime check per action)
- [x] `mode: enforce | observe` (observe = score and log asks/blocks; hard rules still block); `preset: relaxed | balanced | strict`
- [x] `on_error: ask | allow` (default `ask`); `allow` is logged to stderr at first use; shown in the extension (VS Code extension feature)
- [x] Override `cutoffs`, any category's points, `off`, or `block`; `protected_paths`; `trusted_commands` (exact match per parsed command piece, never scored); `trusted_domains`; `offline` (no registry calls and no `dep_unverified`; lookalike and new-registry checks still run)
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

#### Ask through the conversation (after Risk rubric ②)
Cline's interactive auto-approve all approves a plugin's `autoApprove: false` without asking, so the ask tier silently allows (`--yolo` one-shot runs still show the `[y/N]` prompt — tested 2026-10-15).
Approval is read from the conversation history (`rubric/approval.ts`), never from a retry alone: the same tool and input were refused with the same reason, the user's next typed reply is a plain yes, and that yes is unused. Only the user's own agent can be approved; subagents and teammates stay refused. `ask_question` answers don't count. One-shot runs end refused; the user replies through `cline --id <session>`.
- [x] Ask = skip with a reason telling Cline to ask the user in chat; after the user agrees, the identical action is allowed once
- [ ] Works the same with auto-approve on or off, interactive and one-shot; headless with no user → stays refused
- [ ] Report upstream: a plugin's `autoApprove: false` should override auto-approve all

#### Terminal visibility (`/clineshield`)
- [x] Slash command (`"commands"` capability) prints this session's allowed / asked / blocked counts and riskiest files (edits and commands counted per action; an ask refused then approved counts once; allowed commands with no findings aren't logged, so they aren't counted)
- [x] `/clineshield why`: the last ask/block in full (every category, points, total, cut-off)
- [x] Shows config warnings and an `on_error: allow` notice
- [x] Never throws; clear message when there are no events; unit test against a fixture `metrics.json`
- [x] To make `why` possible, `edit-blocked` / `edit-approval` gained optional `score`, `reasons`, `cutoffs` and `command-assessed` gained optional `cutoffs` (owner decision 2026-11-09; additive, old events stay valid)
- Needs CLI 3.0.74+: older CLIs ran commands in a separate plugin copy that doesn't know the session
- [x] Manual (2026-10-15): the user sees the block reason in the terminal as `Error: ClineShield blocked this action…`

#### VS Code extension (optional dashboard)
Design: `docs/superpowers/specs/2026-11-10-extension-dashboard-design.md`.
- [x] Shows `edit-approval` outcomes, `command-assessed` events and rubric categories: sidebar "Waiting on you" (unanswered asks and the latest block; cleared by the approval, a newer ask/block, a later action ≥ 15 s after, or ×), totals counted as `/clineshield` counts, last 15 actions, labelled Settings (preset, mode, config file, `on_error: allow` and config warnings)
- [x] Change map marks files with a blocked attempt: level is the worst of `risk-assessed`, asked (medium) and blocked (high)
- [x] No longer sets env vars for hooks or writes to `metrics.json` at activation; works when no plugin has run yet (install / "watching this repo" empty states)
- [x] Opt-in LLM explanation: on click only, key is the switch, own Gemini key in SecretStorage ("Set/Clear Gemini API Key", sent in a header, never the URL),
  secrets stripped before sending, `gemini_api_key` in YAML ignored with a warning, plugin writes the diff sidecar (`.cline-shield/diff-context.json`, newest 50, redacted)
- [x] Reads `~/.cline-shield.yml` read-only through the plugin's `ConfigStore`; watches it; "Reload Config" as fallback; "Create config" writes it only when missing, after confirming
- [ ] Manual: sidebar, change map and explanations checked by the owner in a real session

#### Retire 1.x hooks
- [x] Remove `clineshield/hooks/`, root and `test-workspace/` `.clinerules/hooks/`, and hook-only env-var code in `configLoader.ts` (deleted with `test-workspace/`, the 1.x `rulesEngine.ts` and the phase-6 smoke test; `.vscode/launch.json` opens `~/clineshield-sandbox`)

#### Evaluation ⛔
- [ ] 20–30 tasks in a purpose-built eval project, labelled safe/destructive in advance, approved by the owner with a budget
- [ ] Report: destructive actions attempted / caught, false positives (safe actions asked or blocked), time added (median, p95)
- [ ] Raw results committed; README numbers are exactly what the run produced

#### README (last)
- [ ] One-line install, architecture diagram, rubric + config guide, eval results, CI badge, "what's next"

### Later
- Post-edit checks (the 2.0 sanity checks), cut from 2.0 on 2026-11-09. Planned scope: after an edit, run the project's checkers (configurable per file glob; default prettier → eslint → tsc for TS/JS), feed errors back through `appendContext` ("Attempt X/N"), stop after `max_retries` per task + file, write `sanity-passed` / `sanity-failed`, and feed the result into the after-edit score. Cut because it is code quality, not safety (Cline usually catches these errors when it runs the build or tests); it is the hardest remaining piece under the 3 s hook limit (background checkers, results delivered on a later hook call); and running a cloned repo's eslint/prettier config executes that repo's code, which breaks the rule that a cloned repo can't change anything. Settle how untrusted repos are handled before building it.
- Dependency categories deferred from ③: `dep_added` (10), `dep_unpinned` (15), `dep_downgrade` (20), `dep_low_downloads` (40, < 1,000/week, npm only).
- `/clineshield init` and `/clineshield preset <name>` (edit the config file; the handler gets the text after the command name, see Appendix)
- LLM providers beyond Gemini: VS Code model API (needs Copilot), OpenAI-compatible endpoints (OpenRouter, local Ollama)
- LLM explanations for CLI-only users (plugin-side, key from an env var)
- Code structure via tree-sitter (WASM `web-tree-sitter` + ~6 grammars, ~10 MB; native bindings ruled out: need a compiler on install). Only if the eval shows patterns miss real deletions
- Promote log-only signals to points when the eval shows they help
- Project config (`.cline-shield.yml` in a repo), tighten-only: a repo can add protection but never loosen it.

---

## Open decisions

| # | Question | Status |
|---|---|---|
| 9 | Rubric defaults: starting points and cut-offs set in Risk rubric (2026-10-15) | open → tune with the eval |

**Decided**
- **1** — Commands get a new `command-assessed` event (`command, tier, score, reasons, approved?`) added to `metrics.ts`, one per `run_commands` request; the extension learns it (2026-10-15).
- **2** — Ask-tier outcome: new `edit-approval` event (`file, structuralChangePercent, functionsDeleted, exportsDeleted, reason, approved`). `approved: false` is written in `beforeTool` when the action is refused pending the user (incl. headless); `approved: true` in `afterTool` when it runs after their yes, so an approved action logs both. `command-assessed` `approved` works the same way.
- **3** — Late post-edit check results: no new event type; if post-edit checks are built later, late results are logged as normal `sanity-passed` / `sanity-failed` when delivered. Post-edit checks are cut from 2.0 (2026-11-09).
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
| `run_commands` input is one of 9 shapes: `{commands: string[]}`, `{commands: (string \| {command, args?})[]}`, `{commands: string \| {command, args?}}`, `{command, args?}[]`, `{command, args?}`, `{command: string}`, `{cmd: string}`, `string[]`, `string`. A `{command, args}` entry runs without a shell; `{command}` without `args` is a shell string | `core/src/extensions/tools/schemas.ts` L127–172, `helpers.ts` L140–165 (`main` ee7f4f5) |
| Plugins can add slash commands (`"commands"`, `api.registerCommand`) | [plugin reference](https://github.com/cline/cline/blob/main/.agents/skills/cline-sdk/references/plugins/REFERENCE.md) |
| A command handler gets the text after `/name`, trimmed (`/clineshield why` → `"why"`). A reply-only result is shown in the terminal and the turn ends with 0 tokens; nothing enters the conversation (only `submitPrompt` reaches the model). From CLI 3.0.74 (`@cline/core` 0.2.0) a command runs in the session's own plugin copy; 3.0.73 used a separate per-workspace copy (`main` 1e8ae47) | `core/src/services/plugin-command-api.ts`, `core/src/runtime/host/local-runtime-host.ts`, `apps/cli/src/runtime/interactive/chat-command-runner.ts` |
| CLI auto-approve all (`toolAutoApprove`) returns `approved: true` before looking at the request's policy, so a hook's `autoApprove: false` is overridden | `apps/cli/src/runtime/interactive/approvals.ts` `requestToolApproval` |
| `beforeTool` gets `snapshot.messages` (full history with roles). Typed user turns and steers are stored as `<user_input mode="…">text</user_input>`, optionally with a `<mode_notice>`; other user-role messages (`<hook_context>`, reminders, loop and recovery notices, compaction summaries) are not user speech. A skip is stored as a tool result `{ output: { error: reason }, isError: true }` (`main` 94eecbb) | `agents/src/agent-runtime.ts`, `core/src/runtime/host/local-runtime-host.ts`, `shared/src/prompt/format.ts` |
| Subagents and teammates run plugin hooks, and their task arrives as a user-role message written by another model. Subagents have `parentAgentId`; teammates have neither it nor `agentRole` | `core/src/extensions/tools/team/{delegated-agent,multi-agent,team-tools}.ts` |
| `ask_question` returns the model-written `options[0]` when there is no TTY | `apps/cli/src/utils/approval.ts` |
| Plugins load from `<workspace>/.cline/plugins/` or `~/.cline/plugins/`; template: `sdk/examples/plugins/gitignore-read-files-guard.ts` | [docs](https://docs.cline.bot/customization/plugins) |
