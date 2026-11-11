# Extension Dashboard 2.0 + Retire 1.x — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VS Code extension a 2.0 dashboard over `metrics.json` (asks, commands, categories, blocked files, on-click Gemini) and then remove every 1.x hook and `test-workspace/`.

**Architecture:** All data shaping lives in pure, vscode-free modules with Jest tests (`dashboard.ts`, `aggregate.ts`, `configView.ts`, `explain.ts`, plugin `sidecar.ts`, `redact.ts`). Providers and `extension.ts` only do I/O, watching and rendering. The plugin gains one small best-effort sidecar writer plus one config warning.

**Tech Stack:** TypeScript, VS Code extension API (^1.109), Jest + ts-jest, js-yaml, Gemini REST (`gemini-2.5-flash`).

**Spec:** `docs/superpowers/specs/2026-11-10-extension-dashboard-design.md` (read it first). Also `SPEC.md` sections "VS Code extension", "Retire 1.x hooks", Decisions 1, 2, 7, 10; `clineshield/src/types/metrics.ts`.

All paths below are relative to the worktree `/Users/hanschundekad/ClineShield-ext`. Run tests from `clineshield/`: `npm test`. Compile check: `npm run compile`.

## Global Constraints

- `metrics.json` schema is fixed (`clineshield/src/types/metrics.ts`). No new event types or fields. Old events without `score` / `reasons` / `cutoffs` must still render.
- Async file ops only in extension code; UI updates < 100 ms; metrics watcher debounced ~50 ms.
- Every `FileSystemWatcher` registers both `onDidCreate` and `onDidChange`.
- Must work with no Gemini key, no `~/.cline-shield.yml`, no `metrics.json`.
- Log-derived text (commands, paths, reasons, LLM output) reaches the webview DOM only via `textContent` / DOM APIs. `metrics.html` contains no `innerHTML`. CSP with a script nonce.
- Gemini key: only in `context.secrets` under `clineshield.geminiApiKey`; sent as header `x-goog-api-key`; never in a URL, log line or file.
- Extension never writes `~/.cline-shield.yml`; never writes `metrics.json` except the dev command "Generate Test Metrics".
- Ask counting = `summarize()` in `src/plugin/visibility/report.ts` (refused then approved = one ask).
- Waiting-on-you clearing threshold: **15 s** (`WAIT_CLEAR_MS = 15000`). Recent activity: **15** items. Sidecar: newest **50** entries, diff ≤ **4000** chars. File contents to Gemini ≤ **8000** chars. Gemini spacing ≥ **6000 ms**.
- Never open or print any `.cline-shield.yml` (they hold API keys). Back up `~/.cline-shield.yml` by copying only.
- Commits: `<type>(<scope>): <subject>`, no mention of Claude/AI, no Co-Authored-By. PROGRESS.md never edited.
- SPEC.md boxes ticked in the same commit that completes the feature.

## Review Focus

1. A command or file path containing HTML (`<img src=x onerror=alert(1)>`) shows as literal text in Waiting/Recent and the change map → Task 4 test keeps text verbatim; Task 8 static test forbids `innerHTML` and requires CSP.
2. `metrics.json` missing, empty, not an array, or holding malformed events (null, no `data`, unknown `type`) → empty dashboard / empty map, no throw → Task 4 and Task 5 tests.
3. 1.x-era events: `edit-blocked` with no `score`/`reasons`/`cutoffs` → Waiting item shows `reasonText`; change map marks the file high + blocked → Tasks 4, 5.
4. Two parallel sessions writing actions with the same timestamp → separate items, separate waiting state → Task 4 test.
5. Sidecar path unwritable (e.g. `diff-context.json` is a directory) → plugin still returns the same decision and logs the event → Task 3 test.

---

## Phase 1 — Extension (commits: one per task; SPEC ticks in Task 9)

### Task 1: Shared secret redaction

**Files:**
- Create: `clineshield/src/plugin/rubric/redact.ts`
- Test: `clineshield/src/plugin/rubric/__tests__/redact.test.ts`

**Interfaces:**
- Consumes: `SECRET_PATTERNS` from `clineshield/src/plugin/rubric/checks/hard.ts`.
- Produces: `export const REDACTED = '[REDACTED]'`; `export function redactSecrets(text: string): string`.

- [ ] **Step 1: Write the failing tests** — `redactSecrets`:
  - replaces an AWS key `AKIAABCDEFGHIJKLMNOP` → `[REDACTED]`, rest of line unchanged;
  - replaces *every* occurrence (two GitHub tokens `ghp_` + 36 alnum on two lines → two `[REDACTED]`);
  - replaces a `-----BEGIN RSA PRIVATE KEY-----` header and an `api_key = "abc123…(20+ chars with digit)"` assignment;
  - leaves `const x = 1;` unchanged; returns `''` for `''`.
- [ ] **Step 2:** `npx jest src/plugin/rubric/__tests__/redact.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** — for each pattern build `new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g')` once at module load; replace in sequence.
- [ ] **Step 4:** rerun → PASS.
- [ ] **Step 5: Commit** `feat(plugin): add shared secret redaction`.

### Task 2: Config warning for `gemini_api_key`

**Files:**
- Modify: `clineshield/src/plugin/config/schema.ts` (the `LEGACY_KEYS` skip near line 134)
- Test: `clineshield/src/plugin/config/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `validateConfig({ gemini_api_key: 'x' }).warnings` contains exactly
  `'gemini_api_key is ignored — set the key in VS Code with "ClineShield: Set Gemini API Key"'`.

- [ ] **Step 1: Failing tests:** the warning above appears for `gemini_api_key`; it never contains the key's value (`'AIzaSECRET'` not in any warning); other legacy keys (`no-nuke`) still produce no warning.
- [ ] **Step 2:** run schema tests → FAIL.
- [ ] **Step 3: Implement** — before the `LEGACY_KEYS` `continue`, `if (key === 'gemini_api_key') warn(<text>)`.
- [ ] **Step 4:** PASS; also run `npx jest src/plugin/config` (store tests prefix warnings with `~/.cline-shield.yml: `).
- [ ] **Step 5: Commit** `feat(config): warn that gemini_api_key in YAML is ignored`.

### Task 3: Plugin diff sidecar

**Files:**
- Create: `clineshield/src/plugin/sidecar.ts`
- Modify: `clineshield/src/plugin/index.ts` (`decide()` returns the gathered `action`; edit paths in `beforeTool` call the writer)
- Test: `clineshield/src/plugin/__tests__/sidecar.test.ts`, `clineshield/src/plugin/__tests__/sidecarPlugin.test.ts`

**Interfaces:**
- Consumes: `redactSecrets` (Task 1); `isSecretsFile` from `rubric/paths.ts`; `FileOperation` from `patch`.
- Produces:
  ```ts
  export const SIDECAR_FILE = 'diff-context.json';           // in <root>/.cline-shield/
  export const MAX_SIDECAR_ENTRIES = 50;
  export const MAX_SIDECAR_DIFF = 4000;
  export interface SidecarEntry { sessionId: string; timestamp: string; file: string; diff: string }
  export interface Sidecar { entries: SidecarEntry[] }
  export function diffTextFor(op: FileOperation): string;      // unified-ish text: '+'/'-'/' ' prefixed lines; add → all '+'; delete → '(file deleted)'
  export function sidecarEntry(sessionId: string, timestamp: string, file: string, op: FileOperation): SidecarEntry | undefined; // undefined for secrets files; diff redacted then capped (+ '\n... [truncated]')
  export async function appendSidecar(root: string, entries: SidecarEntry[]): Promise<void>; // read (missing/corrupt → empty), append, keep newest 50, temp + rename; never throws
  export async function readSidecar(root: string): Promise<Sidecar>;                          // never throws; {entries: []} on any problem
  ```
- Plugin wiring: in `beforeTool` edit path, for each `FileScore f` with `f.score > 0` on the **allow**, **ask-refused** and **block** branches (and observe mode), build an entry with the **same `timestamp`** as the logged event, from the `FileChange` in `action.changes` whose `path === f.file`. Approved retries (`policy: autoApprove`) write nothing. The `appendSidecar` promise is added to `pending` (so `flush()` awaits it). Commands write nothing.

- [ ] **Step 1: Failing unit tests (`sidecar.test.ts`):** `diffTextFor` for update (context/remove/add lines prefixed `' '`, `'-'`, `'+'`), add, delete; `sidecarEntry` redacts `AKIA…` and returns `undefined` for `.env`; caps at 4000 + `'\n... [truncated]'`; `appendSidecar` keeps newest 50 of 60 in order; corrupt existing file → replaced with new entries; `root/.cline-shield/diff-context.json` is a directory → resolves, no throw.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement `sidecar.ts`.**
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Failing plugin tests (`sidecarPlugin.test.ts`,** same harness as `rubricPlugin.test.ts`: temp git workspace, `createClineShieldPlugin({ homeDir })`, `plugin.flush()`):
  - a blocked edit → sidecar has one entry whose `sessionId`, `timestamp`, `file` equal the `edit-blocked` event's;
  - an asked edit refused → entry matches the `edit-approval approved:false` event; after a simulated approved retry, still one entry;
  - a clean small edit (score 0) → no entry; a `run_commands` request → no entry;
  - an edit adding an `AKIA…` key → entry diff contains `[REDACTED]`, not the key;
  - Review Focus 5: sidecar path is a directory → `beforeTool` result and logged event identical to the normal case.
- [ ] **Step 6:** run → FAIL. **Step 7:** wire into `index.ts`. **Step 8:** `npm test` → all PASS.
- [ ] **Step 9: Commit** `feat(plugin): write diff sidecar for on-click explanations`.

### Task 4: Dashboard model (pure)

**Files:**
- Create: `clineshield/src/sidebar/dashboard.ts`
- Test: `clineshield/src/sidebar/__tests__/dashboard.test.ts`

**Interfaces:**
- Consumes: `MetricsEvent`, `RiskReason`, `Cutoffs` (types); `summarize` from `plugin/visibility/report.ts`; `isSessionStartMarker` from `metrics/sessions.ts`.
- Produces:
  ```ts
  export const WAIT_CLEAR_MS = 15000;
  export const RECENT_LIMIT = 15;
  export interface ActionItem {
    id: string;                       // `${sessionId}|${timestamp}|${kind}`
    sessionId: string; timestamp: string;
    kind: 'edit' | 'command';
    tier: 'allow' | 'ask' | 'block';
    approved?: boolean;               // asks only: true once the approved retry arrived
    target: string;                   // edit: files joined ', '; command: data.command
    files: string[];                  // edits only
    score: number | null;             // max over files; allowed edits: from the next risk-assessed per file in the same session
    reasons: RiskReason[] | null;     // merged; null for old events without them
    cutoffs: Cutoffs | null;
    reasonText: string | null;        // data.reason (edits) when present
  }
  export interface Dashboard {
    waiting: ActionItem[];            // newest first
    totals: { edits: { allowed: number; asked: number; approved: number; blocked: number };
              commands: { asked: number; approved: number; blocked: number } };
    recent: ActionItem[];             // newest first, ≤ RECENT_LIMIT
    hasEvents: boolean;               // any non-marker event in visible sessions
  }
  export function buildDashboard(events: unknown, visibleIds: Set<string>, dismissed: ReadonlySet<string>): Dashboard;
  ```
- Rules (from the spec): items = edit groups (same session + timestamp + event type among `edit-allowed` non-marker / `edit-approval approved:false` / `edit-blocked`) and each `command-assessed` (tier from `data.tier`; observe-mode `tier:'allow'`). An `approved:true` event (edit or command) marks the latest earlier ask in that session with the same target `approved = true` and creates no item. Totals = sum of `summarize(events, id)` over visible ids. **Waiting:** per session, take the latest ask-or-block item; it is waiting unless (1) it's an ask with `approved === true`, (2) any later item in the same session has `timestamp` ≥ its timestamp + 15000 ms, or (3) its id is in `dismissed`. Allowed items never wait.

- [ ] **Step 1: Failing tests** (fixtures built inline; timestamps ISO):
  - empty / `null` / `{}` / array with `null` and `{type:'x'}` → `{ waiting: [], recent: [], hasEvents: false }`, totals all 0 (Review Focus 2);
  - session-start markers alone → `hasEvents: false`;
  - refused ask then `approved:true` → one recent item, `tier:'ask'`, `approved:true`; `totals.edits.asked === 1`, `approved === 1`; not waiting;
  - refused ask, then an allowed edit 3 s later in the same session → still waiting (batch); allowed edit 16 s later → not waiting;
  - ask then a newer block in the same session → only the block waits;
  - dismissed id → not waiting, still in recent;
  - two sessions, same timestamp, one ask each → two waiting items with different ids (Review Focus 4);
  - blocked command with `reasons` + `cutoffs` → item carries them, `score` from data;
  - 1.x `edit-blocked` without score/reasons/cutoffs → `score:null`, `reasons:null`, `reasonText` = data.reason (Review Focus 3);
  - allowed edit followed by `risk-assessed` for the same file (score 30) → item `score: 30`;
  - multi-file blocked edit (2 events same timestamp) → one item, `files` length 2, `score` = max;
  - 20 actions → `recent.length === 15`, newest first;
  - a command `"<img src=x onerror=alert(1)>"` → `target` equals it verbatim (Review Focus 1);
  - only visible sessions count (event from a non-visible session ignored).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(extension): add dashboard model for asks, commands and categories`.

### Task 5: Change map aggregation marks blocked files

**Files:**
- Create: `clineshield/src/changeMap/aggregate.ts`
- Modify: `clineshield/src/changeMap/ChangeMapProvider.ts` (use `aggregateFileStats`; `FileItem` description `· BLOCKED` suffix and `shield`/`error` icon when `blocked`; tooltip "Blocked attempt: yes"; empty-state text "No Cline edits yet")
- Test: `clineshield/src/changeMap/__tests__/aggregate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RiskLevel = 'low' | 'medium' | 'high';
  export interface FileStats { editCount: number; worstLevel: RiskLevel | null; blocked: boolean }
  export function aggregateFileStats(events: unknown): Map<string, FileStats>; // caller passes visible events
  ```
- Rules: level = worst of `risk-assessed.level`, `edit-approval` → `medium`, `edit-blocked` → `high`. `blocked = true` if any `edit-blocked`. `editCount` counts `edit-allowed` (non-marker), `edit-blocked`, and `edit-approval approved:false` unless the previous `edit-approval` for that file in that session was also `approved:false`; `approved:true` never counts. Commands ignored.

- [ ] **Step 1: Failing tests:** blocked file with no `risk-assessed` → `{ worstLevel:'high', blocked:true, editCount:1 }`; refused+approved ask then `risk-assessed low` → `medium`, `editCount 1`; two consecutive refusals → `editCount 1`; old `edit-blocked` without score → high + blocked; malformed input → empty map; session-start marker ignored.
- [ ] **Step 2:** FAIL. **Step 3:** implement + use in provider. **Step 4:** `npm test` PASS, `npm run compile` clean.
- [ ] **Step 5: Commit** `feat(changemap): mark files with a blocked attempt`.

### Task 6: Read-only config view

**Files:**
- Create: `clineshield/src/config/configView.ts`
- Test: `clineshield/src/config/__tests__/configView.test.ts`

**Interfaces:**
- Consumes: `ConfigStore` from `plugin/config/store.ts`.
- Produces:
  ```ts
  export interface ConfigSummary { preset: string; mode: string; onErrorAllow: boolean; warnings: string[]; fileFound: boolean }
  export async function readConfigSummary(store: ConfigStore, homeDir: string): Promise<ConfigSummary>; // never throws
  ```

- [ ] **Step 1: Failing tests** (temp homeDir): no file → `{ preset:'balanced', mode:'enforce', onErrorAllow:false, warnings:[], fileFound:false }`; `on_error: allow` + `preset: strict` → reflected; `gemini_api_key: AIzaFAKE` → warnings include the Task 2 text and no warning contains `AIzaFAKE`; unparseable YAML → defaults + a warning; file changed on disk → second call reflects it.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(extension): read ~/.cline-shield.yml read-only for the config line`.

### Task 7: On-click Gemini explanations

**Files:**
- Rewrite: `clineshield/src/extension/riskAnalysis/llmAnalyzer.ts`
- Replace: `clineshield/src/extension/riskAnalysis/llmTrigger.ts` → `clineshield/src/extension/riskAnalysis/explain.ts` (delete `llmTrigger.ts` and its test)
- Test: `clineshield/src/extension/riskAnalysis/__tests__/llmAnalyzer.test.ts`, `.../__tests__/explain.test.ts`

**Interfaces:**
- Consumes: `ActionItem` (Task 4), `readSidecar` (Task 3), `redactSecrets` (Task 1), `isSecretsFile`.
- Produces:
  ```ts
  // llmAnalyzer.ts
  export const GEMINI_MODEL = 'gemini-2.5-flash';
  export type GeminiResult = { ok: true; explanation: string } | { ok: false; error: string };
  export async function callGemini(key: string, prompt: string, fetchImpl?: typeof fetch): Promise<GeminiResult>;
  // POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
  // headers: Content-Type, x-goog-api-key. Errors: `HTTP <status>`, `empty response`, `network error`. Never throws, never logs the key or request URL with key.

  // explain.ts
  export const MAX_FILE_CHARS = 8000;
  export const GEMINI_MIN_INTERVAL_MS = 6000;
  export interface ExplainDeps {
    root: string;
    getKey: () => Promise<string | undefined>;
    caller?: typeof callGemini;
    readFile?: (abs: string) => Promise<string>;
    now?: () => number; sleep?: (ms: number) => Promise<void>;
  }
  export function buildExplainPrompt(item: ActionItem, diff: string, fileContents: string): string; // all inputs redacted; says the file is pre-edit for ask/block
  export function createExplainer(deps: ExplainDeps): (item: ActionItem) => Promise<GeminiResult>;   // serialised, ≥ 6000 ms between calls; no key → { ok:false, error:'no-key' } without calling
  ```
- Explainer: edits use the sidecar entry matching `sessionId + timestamp + file` (first file) and `readFile(path.join(root, file))` capped at 8000 (skipped for `isSecretsFile`, and for paths that resolve outside `root`). Commands send `target` + reasons only.

- [ ] **Step 1: Failing tests (`llmAnalyzer.test.ts`):** fake fetch receives URL **without** `key=` and header `x-goog-api-key: K`; 429 → `{ ok:false, error:'HTTP 429' }`; malformed body → `empty response`; fetch throws → `network error`; a spy on `console.log/error` never sees `K`.
- [ ] **Step 2: Failing tests (`explain.test.ts`):** no key → `no-key`, caller not called; sidecar match by session+timestamp+file used, mismatch → prompt says diff unavailable; prompt contains `[REDACTED]` not `AKIA…` (from diff, file contents, command and reasons); `.env` item → file contents not read; `../../etc/passwd` file → not read; two calls with fake clock → second waits 6000 ms; blocked edit prompt mentions the edit did not run.
- [ ] **Step 3:** FAIL. **Step 4:** implement both. **Step 5:** `npm test` PASS.
- [ ] **Step 6: Commit** `feat(extension): on-click Gemini explanations with SecretStorage key`.

### Task 8: Sidebar webview + extension wiring

**STOP before Step 3 for owner review of mockups.**

**Files:**
- Rewrite: `clineshield/src/sidebar/metrics.html`, `clineshield/src/sidebar/MetricsSidebarProvider.ts`
- Modify: `clineshield/src/extension.ts`, `clineshield/package.json` (commands)
- Test: `clineshield/src/sidebar/__tests__/metricsHtml.test.ts`

**Interfaces:**
- Consumes: `buildDashboard`, `readConfigSummary`, `createExplainer`, `aggregateFileStats` (via provider), `resolveMetricsRoot`, `selectVisibleSessionIds`.
- Messages extension → webview: `{ type:'update', dashboard: Dashboard, config: ConfigSummary, hasKey: boolean, explanations: Record<string, { state:'loading'|'done'|'error'; text: string }> }`.
- Messages webview → extension (validated; unknown types and ids not in the current dashboard ignored): `{ type:'explain', id }`, `{ type:'dismiss', id }`, `{ type:'setKey' }`.
- Commands (package.json + registration): `clineshield.setGeminiKey` "ClineShield: Set Gemini API Key" (`showInputBox({ password: true, ignoreFocusOut: true })`, stored via `context.secrets.store('clineshield.geminiApiKey', …)`), `clineshield.clearGeminiKey` "ClineShield: Clear Gemini API Key", `clineshield.reloadConfig` "ClineShield: Reload Config" (re-reads config, refreshes). Remove `clineshield.deactivate`.

- [ ] **Step 1: Mockups.** Invoke the `impeccable:impeccable` skill on the sidebar (VS Code sidebar width ~300 px, theme variables, light/dark/high-contrast): states = waiting (ask with categories + block), all clear, empty (no events), Explain loading/done/error, explanations off ("Explanations off · Set key"), config warning + `on_error: allow`. Order: Waiting on you → totals line → Recent activity → config line.
- [ ] **Step 2: STOP — show the owner the mockups; wait for approval or changes.**
- [ ] **Step 3: Failing test (`metricsHtml.test.ts`):** reads `metrics.html`; asserts no `innerHTML`, no `outerHTML`, no `insertAdjacentHTML`, no `document.write`; has `<meta http-equiv="Content-Security-Policy"` with `script-src 'nonce-{{nonce}}'` and `default-src 'none'`; every `<script` tag has `nonce="{{nonce}}"`.
- [ ] **Step 4:** FAIL. **Step 5:** build `metrics.html` from the approved mockup (DOM APIs only; provider substitutes `{{nonce}}` and `{{cspSource}}`).
- [ ] **Step 6: Provider:** reads events (`readEvents(metricsRoot)`), filters with `selectVisibleSessionIds`, builds dashboard; holds `dismissed: Set<string>` and explanation cache in memory; handles messages above; `refresh()` debounced 50 ms.
- [ ] **Step 7: `extension.ts`:** remove `loadConfig` import/calls, `process.env.CLINESHIELD_SESSION_ID` (set and delete), the activation `session-start` write, `processedRiskTimestamps` + Gemini queue + auto `processRiskEvent`, `clineshield.deactivate`. Keep `currentSessionId = randomUUID()` and `activationTime` (Decision 7). Add: `ConfigStore({ homeDir: os.homedir() })`; watcher `new RelativePattern(Uri.file(os.homedir()), '.cline-shield.yml')` with `onDidCreate`, `onDidChange`, `onDidDelete` → sidebar refresh; status bar text `$(shield) ClineShield` or `$(shield) ClineShield · N waiting` from `dashboard.waiting.length`; works with no workspace folder (sidebar shows the empty state). Rewrite "Generate Test Metrics" to emit 2.0 events (one allowed edit + risk-assessed, one refused-then-approved ask with reasons/cutoffs, one blocked edit, one blocked command) under the extension's own session id.
- [ ] **Step 8:** `npm test` PASS; `npm run compile` clean; `grep -rn "CLINESHIELD_" clineshield/src --include='*.ts' | grep -v configLoader.ts` → no hits (`configLoader.ts` is deleted in Task 10).
- [ ] **Step 9: Commit** `feat(extension): 2.0 sidebar with asks, commands and categories`.

### Task 9: Extension SPEC ticks + docs (closes Phase 1)

**Files:** `SPEC.md` ("VS Code extension (optional dashboard)": tick all four, adding one line noting on-click explanations, key = switch, 15 s clearing; "Rubric configuration" `on_error` line stays ticked), `CLAUDE.md` (sessionId section: extension keeps its own UUID in memory; no env var), `README.md` extension section (Set/Clear Gemini key, on-click Explain, reads `~/.cline-shield.yml`).

- [ ] **Step 1:** edit docs. **Step 2:** `npm test` PASS. **Step 3: Commit** `docs(spec): tick VS Code extension dashboard`.

---

## Phase 2 — Retire 1.x (separate commit, last)

### Task 10: Remove hooks, 1.x code and test-workspace/

**Files:**
- Delete: `clineshield/hooks/`, `.clinerules/hooks/` (incl. `TESTING.md`), `test-workspace/` (entire, tracked files), `clineshield/src/config/configLoader.ts`, `clineshield/src/extension/riskAnalysis/rulesEngine.ts` + `__tests__/rulesEngine.test.ts`, `clineshield/scripts/smoke-test-phase6.js` + `smoke:phase6` script in `clineshield/package.json`.
- Modify: `.vscode/launch.json` "Run Extension" second arg → `${env:HOME}/clineshield-sandbox`; `README.md`, `CLAUDE.md` (file layout, hook rules, `.clinerules/hooks` copies line), `.cline-shield.example.yml` (drop 1.x note); `SPEC.md`: tick "Retire 1.x hooks" (wording: also `test-workspace/`), replace `test-workspace/` in the manual-test line with "a disposable git repo" and in Evaluation with "a purpose-built eval project". Leave PROGRESS.md.
- Keep: `clineshield/src/hooks/clineshield-analyze.js` and its test; `llmAnalyzer.ts` imports `RiskReason` from `types/metrics.ts` instead of `rulesEngine`.

- [ ] **Step 1:** `git rm -r` the paths above (tracked only; never open the gitignored `.cline-shield.yml` files).
- [ ] **Step 2:** `grep -rnE "test-workspace|\.clinerules/hooks|clineshield/hooks|CLINESHIELD_[A-Z_]+|configLoader|rulesEngine|smoke-test-phase6" --exclude-dir=node_modules --exclude-dir=.git . | grep -v PROGRESS.md | grep -v docs/superpowers` → no hits except intentional history mentions in SPEC "1.x" section.
- [ ] **Step 3:** `npm test` PASS; `npm run compile` clean.
- [ ] **Step 4: Commit** `chore(repo): retire 1.x hooks and test-workspace`.
- [ ] **Step 5:** Tell the owner to delete by hand (gitignored, contain an API key): `test-workspace/.cline-shield.yml` and root `.cline-shield.yml` in the primary checkout. Do not print their contents.

## Handoff

After Task 10: report test count, compile status, `git status` clean, and the two files for the owner to delete. Phase 3 (manual test with the owner, see spec) starts only after this, interactively.
