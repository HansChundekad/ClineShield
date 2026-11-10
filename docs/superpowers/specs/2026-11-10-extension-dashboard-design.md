# Extension dashboard for 2.0 + retire 1.x — design

Date: 2026-11-10 · Branch: `phase-9/extension-dashboard` · SPEC sections: "VS Code extension (optional dashboard)", "Retire 1.x hooks"

## Intent

ClineShield 2.0 is a Cline plugin that scores every action and returns allow / ask / block, logging to
`.cline-shield/metrics.json`. The VS Code extension is an optional dashboard over that log. Today it still speaks
1.x: it sets env vars for bash hooks, reads a per-repo YAML the plugin ignores, doesn't read `edit-approval` or
`command-assessed`, and auto-sends medium/high edits to Gemini with a key from YAML. This work makes the
extension a 2.0 dashboard, then removes 1.x.

The developer's question when glancing at the sidebar mid-session: **"did ClineShield just stop something, and is
it waiting on me?"** The sidebar answers that first.

## Goals

1. Sidebar: "Waiting on you" → one-line totals → recent activity → config line (owner-approved order).
2. Shows `edit-approval` outcomes, `command-assessed` events (Decision 1) and rubric categories (points, total, cut-off).
3. Change map marks files with a blocked attempt; level reflects asked/blocked attempts, not only `risk-assessed`.
4. No env vars for hooks; works with no events and before any plugin run.
5. Gemini explanations: opt-in, on click only, key in SecretStorage, secrets stripped before sending.
6. Retire 1.x: hooks, hook copies, hook-only config code, `test-workspace/`.

## Non-goals

- No change to the `metrics.json` schema (types in `clineshield/src/types/metrics.ts` on main, incl. the optional
  `score` / `reasons` / `cutoffs` added 2026-11-09).
- No config editing from the extension. It never writes `~/.cline-shield.yml`.
- No new LLM providers; no CLI-side explanations (SPEC "Later").
- Riskiest-files list stays in the change map, not the sidebar.
- Session signals (#5) aren't built; not covered.

## Anti-goals (failure even if it "works")

- Log-derived text (commands, file paths, reasons) rendered as HTML → injection in the webview.
- Gemini key in any file, log line or request URL.
- Code or secrets sent to Google without the user clicking Explain.
- An ask that was refused then approved counted as two asks (Decision 2).
- Extension host blocked by sync I/O; UI updates over 100 ms.

## Constraints

- CLAUDE.md rules: async file ops, atomic writes (temp + rename), watchers register `onDidCreate` and `onDidChange`.
- Extension must work with no Gemini key, no config file, no `metrics.json`.
- Plugin-side change kept small (sidecar + one config warning).
- TDD; `npm test` in `clineshield/` before any claim. SPEC boxes ticked in the same commit. PROGRESS.md frozen.
- Commit extension work and hook removal separately; hooks removed last.

## Decided with the owner

### Config (Decision 10)
- The extension reads `~/.cline-shield.yml` **read-only**, through the plugin's own `ConfigStore`
  (`src/plugin/config/store.ts`) so values and warnings match the plugin exactly.
- It watches the file (`RelativePattern(Uri.file(os.homedir()), '.cline-shield.yml')`, both create and change)
  and refreshes the config line on save. `clineshield.reloadConfig` stays as a manual fallback that re-reads it
  (the home folder is outside the workspace, so the watcher can be less reliable).
- `<workspace>/.cline-shield.yml` is no longer read by anything.
- The config line shows `preset · mode`, a warning when `on_error: allow`, and any config warnings.
- `gemini_api_key` in YAML is ignored with a warning (see Gemini).

### Sidebar (owner approved the order; details marked *(my call)* are mine)
- **Waiting on you** (top): unanswered asks and the latest block, each with file/command, tier, and categories
  with points, total and cut-off, e.g. `rm_outside +60 · total 60 → block at 70`. Collapses to "All clear".
  - **Clearing (owner decision 2026-11-10):** an ask (`approved:false`) stays until the first of:
    (1) its `approved:true` retry; (2) a newer ask or block in the same session (only the latest per session stays);
    (3) a later action logged in the same session **≥ 15 s** after the ask (the conversation moved on — batched
    tool calls land within seconds, so they don't clear it); (4) the user dismisses it with × (in memory, per
    extension session). The latest block follows rules 2–4. Older events without `reasons`/`cutoffs` show the
    `reason` text.
  - The status bar's "N waiting" uses the same rule.
- **Totals** (one line): `Edits 12 allowed · 2 asked (1 ✓) · 1 blocked | Commands 1 asked · 0 blocked`.
  Counted exactly as `/clineshield` counts — call `summarize()` from `src/plugin/visibility/report.ts` per visible
  session and sum (so an ask refused then approved is one ask; allowed commands with no findings aren't logged).
- **Recent activity**: *(my call)* last 15 actions across visible sessions, newest first: tier badge, file or
  command, score, relative time. Click to expand categories. An approved ask shows as "asked ✓".
- **Config line** (bottom), as above.
- **Empty state**: "No Cline activity yet. ClineShield logs here once a Cline session runs with the plugin."
- The 1.x sanity/retry stats are removed (post-edit checks were cut from 2.0).
- Sessions shown follow Decision 7 (unchanged `selectVisibleSessionIds`).
- Design is done with the impeccable skill; no mockups exist yet. The plan builds the data layer, sidecar,
  Gemini/SecretStorage, change map first, then **stops for the owner to review mockups** before the webview HTML.

### Change map *(my call on exact levels)*
- Per file, level = worst of: `risk-assessed.level`; asked edit (`edit-approval`) → at least `medium`;
  blocked edit (`edit-blocked`) → `high`. Files with any blocked attempt get a "blocked" marker in the
  description/tooltip and a distinct icon. Works for old events without `score`.
- Edit count counts actions (an ask refused then approved counts once). Commands don't appear in the change map.

### Gemini explanations
- Off by default. **The key is the switch**: no key → no requests, sidebar shows "Explanations off · Set key".
- Commands **ClineShield: Set Gemini API Key** (masked input box) and **ClineShield: Clear Gemini API Key**;
  stored in `context.secrets` (SecretStorage → macOS Keychain).
- **On click only**: an "Explain" action on items in Waiting on you and Recent activity (edits and commands with
  score > 0). Nothing is sent automatically. The auto-trigger, `processedRiskTimestamps` and the watcher-driven
  queue go.
- Key sent in the `x-goog-api-key` header, not the URL. Never logged.
- `gemini_api_key` in YAML: ignored; the plugin's config validator emits a specific warning
  ("gemini_api_key is ignored — set the key in VS Code with ClineShield: Set Gemini API Key"), which shows in
  the extension's config line and in `/clineshield`.

### Retire 1.x
- Remove `clineshield/hooks/`, root `.clinerules/hooks/` (incl. `TESTING.md`), `test-workspace/.clinerules/hooks/`,
  hook-only env-var code (`configLoader.ts` goes entirely; its replacement is the read-only config view).
- Remove `CLINESHIELD_SESSION_ID`; Decision 7 behaviour unchanged (the extension's own UUID stays in memory).
- **Delete `test-workspace/` entirely** (owner, item 6). `.vscode/launch.json` "Run Extension" opens
  `~/clineshield-sandbox` (a throwaway git repo outside this repo; any folder inside this repo resolves to its git
  root and would write to the tracked `.cline-shield/metrics.json`). SPEC's `test-workspace/` mentions become
  "a disposable git repo" (manual-test lines) / "a purpose-built eval project" (Evaluation).
- Tell the owner to delete the gitignored `test-workspace/.cline-shield.yml` and root `.cline-shield.yml` by hand.
  **Never print their contents** (they hold an API key).
- Update references in README.md, CLAUDE.md (file layout, `sessionId` env-var paragraph, hook rules),
  `.cline-shield.example.yml` (its 1.x note). PROGRESS.md untouched.

## The plugin-side diff sidecar (small)

`llmTrigger.ts` reads `.cline-shield/diff-context.json`, written today only by `hooks/PostToolUse`. With on-click
explanations for any listed item (including asked and blocked edits that never ran), a single-slot sidecar isn't
enough.

- *(my call)* The plugin writes `.cline-shield/diff-context.json` (next to `metrics.json`, same root) as
  `{ "entries": [{ sessionId, timestamp, file, diff }] }`, keeping the newest 50 entries. One entry per file of
  every edit decision with score > 0 (allowed, asked or blocked), `timestamp` identical to the logged event's, so
  the extension matches on `sessionId + timestamp + file`.
- `diff` = that file's part of the patch / new content, capped at 4,000 chars, with every match of
  `SECRET_PATTERNS` (`src/plugin/rubric/checks/hard.ts`) replaced by `[REDACTED]`; secrets files
  (`isSecretsFile`) get no diff at all.
- *(my call)* Keying: the sidecar entry is written in `beforeTool` with the **decision event's** timestamp —
  `edit-allowed` (using the before-action score, written only when > 0), `edit-approval approved:false`, or
  `edit-blocked`. An approved retry writes nothing new: its Recent activity item is the original ask (shown as
  "asked ✓") and uses that ask's entry. The extension pairs an allowed edit with the next `risk-assessed` for the
  same file and session (by order) for its displayed score; Explain is offered when that score, or the
  ask/block score, is > 0.
- Atomic write (temp + rename), best effort, never throws, never delays the decision (fire and forget, tracked in
  the plugin's `pending` set like `record()`). Parallel sessions may race and drop an entry; Explain then sends
  without a diff. Not a `metrics.json` event, so no schema change.

## Explain flow (extension)

1. User clicks Explain on an item. If no key → prompt to set one.
2. Gather: item type, file or command, tier, score, reasons, cut-offs; for edits, the sidecar diff (if matched)
   and the current file contents (capped 8,000 chars; skipped for secrets files; for blocked/asked edits it's the
   pre-edit file, and the prompt says so).
3. Strip secrets from **everything** sent (diff, file, command, reasons) with the same `SECRET_PATTERNS` —
   shared module, also used by the plugin sidecar. Unit-tested.
4. Call Gemini (`gemini-2.5-flash`, existing prompt adapted for allow/ask/block and commands), 6 s minimum
   spacing kept.
5. *(my call)* Show the result inline under the item and cache it in memory for the extension session; not
   written to `metrics.json` (keeps the extension read-only toward the log and avoids stretching `llm-analysis`
   for commands, whose `file` field doesn't fit). Errors show a short message ("Gemini request failed: HTTP 429").

## Other calls *(mine)*

- **Extension stops writing to `metrics.json`** at activation (the 1.x `session-start` marker for hook sessions).
  Its own session id still counts as visible (Decision 7). Opening VS Code on a repo no longer creates
  `.cline-shield/`. "Generate Test Metrics" (dev command) still writes, rewritten to emit 2.0 events.
- Remove the stub `clineshield.deactivate` command ("Disable hook scripts…").
- Remove `src/extension/riskAnalysis/rulesEngine.ts` (1.x rules engine; only a type import uses it) and
  `scripts/smoke-test-phase6.js` + its npm script (drives the hooks), in the retire commit. Keep
  `src/hooks/clineshield-analyze.js` (standalone prototype, not hook-coupled).
- Status bar: shows `$(shield) ClineShield` and, when Waiting on you is non-empty, `· N waiting`; tooltip keeps
  sessions/events.
- Data shaping lives in pure, vscode-free modules (e.g. `src/sidebar/dashboard.ts`, change map aggregation) so
  they're unit-tested; providers only do I/O and rendering.
- Webview: `textContent` / DOM APIs only for log-derived text (no `innerHTML` with data), a CSP with a nonce,
  messages from the webview validated (Explain carries an item id the extension looks up; never a path).
- Watchers: metrics.json watcher refreshes sidebar, change map and status bar; ≤ 1 read per burst (debounce
  ~50 ms) so updates stay under 100 ms.

## What's left to the builder

- Exact visual design of the sidebar (via impeccable, owner reviews).
- Module/file names and test layout.
- Prompt wording for Explain.

## Then: final manual test of 2.0 (Phase 3)

Phase 1 = extension work (commit 1), Phase 2 = retire 1.x (commit 2, last). The plan for this document ends
there with a handoff checklist; Phase 3 is run interactively with the owner, not as a plan step.
Phase 3 covers: allow/ask/block for an edit and a command; ask approved in chat, a changed action re-asked, with
auto-approve on/off, interactive and one-shot (`cline --id <session>`), headless stays refused, Cline never sees
points or cut-offs; dependencies (made-up package, popular package, `offline: true`, private registry not looked
up publicly); `/clineshield` and `/clineshield why` output stays out of the conversation; extension checks (asks
and categories in the sidebar, blocked file in change map, nested folder, before any plugin run, Gemini off by
default then works after setting a key); nothing breaks with hooks removed. Only owner-confirmed UI checks pass;
results recorded as `Manual (date, CLI version, commit)` lines and SPEC boxes ticked only for what passed.
Runs after phases 1–2 pass tests, in `~/clineshield-sandbox` (and a nested folder in a
throwaway repo). Owner's Cline CLI must be ≥ 3.0.74 first. Plugin installed from this branch (`@ref`), extension
run from the "Run Extension" launch config. `~/.cline-shield.yml` backed up (copied, never printed) and restored.
