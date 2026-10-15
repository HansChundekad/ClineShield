# ClineShield 1.x Build Log (frozen)

> **Frozen 2026-10-14.** This is the history of how 1.x (VS Code extension + hook files) was built.
> It is no longer updated. Current features, status and roadmap live in **[SPEC.md](SPEC.md)**.

## Phase 0: Foundation ✅ COMPLETE
- [x] Extension scaffold (activate, deactivate, status bar)
- [x] metrics.json schema defined (src/types/metrics.ts)
- [x] Reader utilities (src/metrics/reader.ts)
- [x] Writer utilities (src/metrics/writer.ts)
- [x] File watcher for metrics.json
- [x] sessionId generation and passing via env var

## Phase 1: No-Nuke Hook (PreToolUse) ✅ COMPLETE
- [x] AST analyzer prototype (src/hooks/clineshield-analyze.js — standalone, not wired into the hooks)
- [x] Patch parsing (Cline's custom patch format)
- [x] Function deletion detection (regex-based; matches `function` declarations and `const x = … =>` only)
- [x] Structural change calculation
- [x] Blocking thresholds (3 functions, or 10+ lines and 75% change)
- [x] Write to metrics.json (edit-blocked, edit-allowed events)
- [x] Create demo files
- [x] End-to-end test (small edit allowed, big rewrite blocked)
- [x] Verify metrics.json integrity

## Phase 2: Sanity Check Hook (PostToolUse) ✅ COMPLETE

    Step 1 (Basic Hook): ✅
    1.1: Skeleton - verified real Cline input schema before assuming field names
    1.2: Run tools prettier → eslint → tsc (sequential, stop on first failure)
    1.3: Write sanity-passed/sanity-failed to metrics.json (atomic write, schema-exact)

    Step 2 (Retry Logic): ✅
    2.1: Retry state in .cline-shield/retry-state.json (composite taskId:file key)
    2.2: contextModification injection ("Attempt X/3", raw tool output, fix-only instruction)

    Step 3 (Testing): ✅
    3.1: Test 1 - first failure → eslint FAIL, retryCount:1, contextModification sent ✓
    3.2: Test 2 - Cline fixed error → sanity-passed, retry-state cleared ✓
    3.3: Tests 3&4 - max retries cutoff + fresh task isolation verified in smoke tests ✓

    Test workspace setup:
    - package.json (prettier, eslint, typescript-eslint, typescript)
    - .prettierrc, eslint.config.js, tsconfig.json

## Phase 3: YAML Config ✅ COMPLETE
- [x] Created .cline-shield.example.yml (committed template with comments)
- [x] Created .cline-shield.yml (local config, gitignored)
- [x] Added .cline-shield.yml to .gitignore
- [x] Updated PreToolUse to read env vars (max_deleted_functions, max_structural_change)
- [x] Updated PostToolUse to read env vars (tools, max_retries, timeout)
- [x] Added configLoader.ts to extension (src/config/configLoader.ts)
- [x] Config loads on extension activation (first thing in activate(), before session ID)
- [x] Added "Reload Config" command (clineshield.reloadConfig)

Implementation: Environment variable approach (no code generation)
- Hooks use ${VAR:-default} syntax for fallback defaults
- Extension reads YAML and sets process.env variables
- No template system needed - hooks remain static files

## Phase 4: Metrics Sidebar ✅ COMPLETE

- [x] MetricsSidebarProvider (src/sidebar/MetricsSidebarProvider.ts)
- [x] Sidebar HTML/JS UI (src/sidebar/metrics.html) — VS Code theme-aware
- [x] Activity bar entry (shield icon) + webview view registered in package.json
- [x] File watcher on metrics.json → real-time refresh on every write
- [x] generateTestMetrics command for dev/demo population
- [x] Session-scoped stats (readEventsBySession — not all-time)
- [x] 5 stat rows: Edits Blocked, Edits Allowed, Sanity Passed, Sanity Failed, Avg Retries
- [x] Avg Retries: averages max retryCount per unique file
- [x] Most Recent Edit panel with badge + relative timestamp
- [x] session-start synthetic event excluded from Edits Allowed counter

Integration tested:
- Sidebar shows 0 on fresh session (session isolation confirmed)
- generateTestMetrics → Blocked=1, Allowed=2, Passed=1, Failed=1, AvgRetries=1
- Manual retryCount append → AvgRetries=3 (correct per-file max formula)
- Real Cline ESLint failure → sanity-failed event written, sidebar updates live

## Phase 5: Rules-Based Risk Scoring ✅ COMPLETE

- [x] rulesEngine.ts (src/extension/riskAnalysis/rulesEngine.ts)
  - computeRiskScore(RiskInput) → RiskResult
  - 8 rules: protected_path(+30), structural_change_medium(+25), structural_change_high(+40),
    deleted_functions_low(+20), deleted_functions_high(+35), sanity_failed(+20),
    large_diff>200(+15), test_file(-10)
  - Tiered rules are not additive (high tier replaces medium)
  - Score capped [0, 100]; level: low(0-30), medium(31-60), high(61-100)
  - RiskReason shape matches RiskAssessedEvent.data.reasons schema
- [x] rulesEngine.test.ts (51 tests, all passing)
- [x] Wired into PostToolUse hook as a bash port (reads structuralChangePercent/deletedFunctions from metrics.json, writes risk-assessed event)
- [x] Wire protected_paths to YAML config (configLoader.ts + .cline-shield.example.yml)
  - Colon-separated env var CLINESHIELD_PROTECTED_PATHS
  - Trailing slash = directory prefix match; no trailing slash = exact basename match
  - Empty list sets "none" sentinel to disable rule
- [x] Surface risk level in sidebar (Most Recent Edit panel)
  - mostRecent scoped to edit-allowed/edit-blocked only
  - risk-assessed event linked by file + timestamp >= edit timestamp
  - edit-blocked shows "Risk: — (edit was blocked)"
  - edit-allowed shows score + LOW/MEDIUM/HIGH badge (green/yellow/red)

## Phase 6: LLM Analysis ✅ COMPLETE

- [x] llmAnalyzer.ts — callGemini(diff, fileContents, filePath, rulesScore, reasons) → GeminiAnalysis | null
  - GeminiAnalysis = { explanation: string } — LLM explains why, rules engine owns score/level/reasons
- [x] Sidecar write in PostToolUse hook (.cline-shield/diff-context.json, file-path matched)
- [x] llmTrigger.ts — processRiskEvent() reads sidecar + file contents, calls Gemini, appends llm-analysis event
  - Wired into extension.ts watcher: seen Set deduplicated, fire-and-forget per medium/high risk event
  - Rate limited: 6s minimum between Gemini calls (free tier: 10 RPM); sequential queue, no drops
- [x] Sidebar display of llm-analysis summary (10s "Analyzing..." loading state)
- [x] Smoke test (scripts/smoke-test-phase6.js, npm run smoke:phase6) — always exits 0
- [x] Fix: atomic rename fires onDidCreate not onDidChange; watcher handles both events

Key decisions:
- Sidecar bridges diff from hook process to extension process (matched on file path, not timestamp)
- Post-edit file contents read by extension — gives Gemini real code even when diff unavailable
- LLM explains why the code is risky — score, level, reasons owned by rules engine only

Known limitations:
- Sidecar race: rapid consecutive edits can overwrite diff-context.json before extension reads it;
  path-matching guard ensures wrong diff → empty diff (not wrong diff applied to wrong file)
- Cross-process writes (hook bash → extension Node) are not serialised by the in-process write queue;
  unique temp paths prevent JSON corruption but simultaneous writes may lose one event (last rename wins)

## Phase 7: Change Map TreeView ✅ COMPLETE

- [x] ChangeMapProvider (src/changeMap/ChangeMapProvider.ts) — read-only TreeDataProvider
  - Per file: edit count (edit-allowed + edit-blocked) and worst risk level from risk-assessed events
  - Folder nodes derive color from worst child file; empty state when no events
  - Own FileSystemWatcher; getChildren() returns [] on any failure
- [x] Registered in extension.ts and package.json (clineshield.changeMapView, below Metrics)
- [x] Click opens the file

## Phase 8: Generate Hooks command ❌ CANCELLED
Superseded by ClineShield 2.0 (Cline plugin). See SPEC.md Part 2.

## Release
- v0.1.0 VSIX published: https://github.com/HansChundekad/ClineShield/releases/tag/v0.1.0

---

## Known Issues (1.x)
- structuralChangePercent is unreliable with no-context patches (mitigated by the 10-line minimum)
- In current Cline (SDK-based), a PreToolUse `cancel` aborts the whole task — see SPEC.md "Why 1.x is out of date"
