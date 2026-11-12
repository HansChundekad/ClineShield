# Handoff: ClineShield 2.0 final manual test (Phase 3)

Date: 2026-11-10 to 2026-11-11. Owner drove real Cline; the agent wrote the steps and checked
`.cline-shield/metrics.json`, `answers.json` and Cline's session logs after every block.
Results are also recorded as "Manual (2026-11-11, …)" lines in SPEC.md.

## 1. What was done

**Setup:** Cline CLI 3.0.74 (macOS), model `~anthropic/claude-haiku-latest`. Plugin installed from the branch
(`cline plugin install https://github.com/HansChundekad/ClineShield@phase-9/extension-dashboard`),
extension run from the "Run Extension" launch config, disposable repo `~/clineshield-sandbox`
(`src/math.ts`, `package.json`, nested `packages/app/`, a committed private-registry `.npmrc`).

**Bugs found by the manual test and fixed (each with a failing test first):**

| Commit | Problem found | Fix |
|---|---|---|
| `377283b` | Sidebar never detected an installed plugin: Cline installs to `~/.cline/plugins/_installed/git/<host>/<repo-id>/package` (5 levels), the check looked 2 deep | Bounded walk (5 levels, skips dot folders and node_modules), `CLINE_DIR`, npm installs |
| `9e49be5` | After installing the plugin the sidebar needed "Reload Config" | Re-check on plugin-folder changes, window focus and view visible; stops once found |
| `2b3ab81` | **Every ask was refused again after the user said yes in a new turn.** Between turns Cline rebuilds history and the refusal comes back as a JSON string, not `{ error }` | Approval reads both shapes; reason must still match exactly |
| `2346cb7` `197550d` `56c0bab` | "Waiting on you" card stayed after the user had answered in chat (needed a disclaimer) | Plugin `beforeModel` records the reply in `.cline-shield/answers.json` (not a metrics event); sidebar clears the card, Recent shows ✓ / ✗ / answered (done by a separate agent, reviewed) |
| `b539d4d` | After "no, then changed my mind", Cline retried without a new yes, then gave up after a valid yes ("retry once") | Ask message: "If they reply yes to that message, retry the identical action. A yes given before this message doesn't count." (owner chose wording-only; double confirm kept for safety) |
| `55d3675` | Users couldn't discover settings like `offline`: Create config wrote only 3 settings | Created file lists every setting (active or commented, one-line help); `CONFIG_KEYS` in the schema + a test that fails if a key is missing |
| `99b8816` | Flaky test (race with background session-start write) | Test waits for the write |

Suite at the end: 844 tests, 51 suites, `tsc` clean.

**Owner decisions made during the test:**
- Ask wording fix only (option A); no "earlier yes counts" logic.
- Starter config lists every option (option A); sidebar stays read-only toward the YAML.
- Answers sidecar instead of a disclaimer on the card.
- Command totals in the sidebar stay without an "allowed" count (zero-score commands aren't logged).

## 2. Test report

*Written as the test lead's assessment. Scope: one tester (the owner), one machine, one OS, one model,
one Cline version. Everything below is evidence from real sessions plus log inspection, not inference.*

### Results

| # | Area | Result | Evidence |
|---|---|---|---|
| 1 | Install, empty states, plugin detection | **Pass** (after 2 fixes) | Install screen → "Watching this repo" with no Reload |
| 2 | Edit allow / ask / block | **Pass** | `edit-allowed`, `edit-approval` false→true, `edit-blocked` (placeholder) |
| 3 | Command allow / ask / block, answer "no" | **Pass** | `discards_work` 10 (clean) allow, 50 ask; `rm_outside` block; no retry after no |
| 3b | Card clears on reply (no / yes / block + reply) | **Pass** (after 1 fix) | `answers.json` no/yes/other; owner confirmed by eye |
| 4 | Auto-approve on/off, interactive/one-shot, headless, changed action | **Pass with one gap** | See gaps; `--yolo` headless stayed refused |
| 5 | Dependencies: made-up, popular, offline, private registry | **Pass** | `dep_missing` 80; manifest 15; `skipped:dep_registry`; `skipped (private registry)` |
| 6 | `/clineshield`, `/clineshield why` stay out of the conversation | **Pass** | Not in session history; Cline couldn't say what the report said |
| — | Cline never sees points or cut-offs | **Pass** | Session messages searched for points/score/cut-off/threshold |
| — | Shell edit of a secrets file (`printf >> .env`) | **Pass** | Asked at 60 (secrets_file + shell_edit) |
| 7 | Nested folder, Gemini Explain | **Not done** | See section 3 |
| 8 | Nothing breaks with 1.x hooks removed | **Not done** (indirectly covered) | See section 3 |

### What it handles well
- The approval chain is strict and survives Cline's turn boundaries, one-shot `--id` resumes and headless runs.
  A yes approves one identical action once; a changed action is scored fresh; a first "no" is final.
- Hard rules held every time they were hit (placeholder, outside-workspace delete).
- Package-name privacy works: no public lookup with `offline: true` or a private default registry.
- The sidebar told the truth in every state we drove, once the answers sidecar landed.

### Risks and things I'm not sure about
1. **Model dependence of the ask flow.** The retry depends on the model following the ask message. We hit two
   model mistakes in one session (pre-confirming, then miscounting retries). The wording fix addressed both, but
   only `claude-haiku` was tested. Other models (Sonnet, GPT, local models) may misbehave differently. A slip only
   costs an extra refusal, never an unapproved action, but it can look broken to a user.
2. **Cline checkpoint restore rewinds `.cline-shield/`.** The owner reverted a conversation and the matching
   `metrics.json` entry was gone. Observed once, not investigated. If confirmed, reverting can erase the audit
   trail. Worth checking whether `.cline-shield/` should be excluded from checkpoints or documented.
3. **Single platform.** macOS only. Plugin detection, file watchers outside the workspace and atomic renames
   are platform-sensitive; Windows and Linux are untested.
4. **Cline internals we depend on (CLI 3.0.74):** plugin install layout, history rebuild shape (JSON-string
   outputs), `beforeRun` vs `beforeModel` timing, session ids. Any Cline release can change these. All are
   documented in SPEC's appendix and in code comments; a smoke test per Cline release is advisable.
5. **`--config <path>` / `CLINE_DIR` in GUI VS Code.** Detection honours `CLINE_DIR` only if VS Code's process
   sees it; `cline --config <dir>` isn't handled. After the first logged event the sidebar treats the plugin as
   installed anyway.
6. **Parallel sessions.** `answers.json` locking is unit-tested (4 processes); not driven manually with two
   Cline sessions at once.
7. **Headless asks leave a card** until × (the session is technically still answerable via `--id`). Acceptable,
   but CI-style users may find it noisy.
8. **Stray temp files.** `metrics.json.<n>.<id>.tmp` files were left in `.cline-shield/` (sandbox and main
   checkout). Both were complete JSON: the writer was killed between write and rename (Cline's 3 s hook limit).
   Fixed on `fix/extension-hardening` (2026-11-12): every atomic writer removes its own temps older than 30 s.
9. **Known limit (from SPEC):** 3 blocks in a row can end a one-shot run at the default `--retries 3`.
10. Not exercised at all: VS Code forks (Cursor, Windsurf), JetBrains, Kanban, the Cline SDK directly,
    very large repos, non-English replies ("sí", "oui" are treated as "other", by design).

### Deferred minors (from the extension's final review)
All fixed on `fix/extension-hardening` (2026-11-12), each with a test: onMessage rejections unhandled; same-ms
command id collision; risk pairing can borrow a later edit's score; a NaN timestamp leaves a waiting item stuck;
no onDidDelete on metrics watchers; Explain uses only the first file; disposables accumulate on re-resolve.

## 3. Not done (next tasks)

*Update 2026-11-12: 7a, 7b and 8 passed on `fix/extension-hardening` (see SPEC); Explain needed a model change to `gemini-3.5-flash-lite`.*

- [x] **Block 7a, nested folder.** Open `~/clineshield-sandbox/packages/app` as the VS Code folder (edit
  `.vscode/launch.json` args or File > Open Folder in the dev window), run a Cline task from that folder, and
  confirm the sidebar and change map show it (the extension reads the git root's `.cline-shield/metrics.json`).
- [x] **Block 7b, Gemini Explain.** With no key: Settings shows "Explanations off · Set Gemini key" and Explain
  prompts for a key. Run "ClineShield: Set Gemini API Key" (owner supplies the key; never print or log it), click
  Explain on an ask/block card: loading → explanation; check the request carries the key only in the
  `x-goog-api-key` header and secrets are redacted. Then "Clear Gemini API Key" → off again.
- [x] **Block 8, hooks removed.** Confirm no `.clinerules/hooks/` exists in the repo or sandbox, Cline sessions
  run without hook errors (none seen during Blocks 1–6), and nothing references `CLINESHIELD_*` env vars.
- [ ] Optional: interactive `cline --auto-approve false`, ask → yes (the one Block 4 gap). Skipped by owner decision 2026-11-12.
- [x] Then tick SPEC's "Works the same with auto-approve…" and "Manual: sidebar, change map and explanations"
  lines if they pass, and give the owner a short results table.

**Cleanup for the owner (by hand):**
- `~/.cline-shield.yml` was created during the test (there was none before). Delete it if you want the
  original state. Never print its contents.
- `~/clineshield-sandbox` can be deleted when testing is over.
- After merging, reinstall the plugin from `main`:
  `cline plugin uninstall ClineShield && cline plugin install https://github.com/HansChundekad/ClineShield`.
