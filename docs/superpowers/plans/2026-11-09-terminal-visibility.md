# Terminal visibility (`/clineshield`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/clineshield` slash command (summary) and `/clineshield why` (last ask/block in full), backed by points, totals and cut-offs now saved in metrics.json.

**Architecture:** Additive optional fields on `edit-blocked`, `edit-approval`, `command-assessed`. A pure module `plugin/visibility/report.ts` counts and formats from `MetricsEvent[]`; `index.ts` only registers the command and passes the new fields.

**Tech Stack:** TypeScript, Jest (`npm test` in `clineshield/`), Cline plugin API (`api.registerCommand`).

**Spec:** `docs/superpowers/specs/2026-11-09-terminal-visibility-design.md`

## Global Constraints

- metrics.json stays a JSON array; new fields are optional; no existing field changes. Use `appendEvent()` / `readEvents()`.
- Points, totals and cut-offs never appear in a `reason` string or anything returned from `beforeTool`/`afterTool`.
- The command returns a reply string only, never `submitPrompt`.
- The handler never throws. `setup` stays synchronous and must tolerate `api` without `registerCommand` (tests pass `{}`).
- Do not update PROGRESS.md. Commit only when the owner asks; commit message must state the metrics.json schema change for the other agents.

## Review Focus

- Multi-file edit (one event per file, same timestamp) → counted as one action. Test in Task 2.
- Ask refused then approved (two events, `approved:false` then `true`) → one ask, one approved. Test in Task 2 for edits and commands.
- Events from another session in the same file → ignored. Test in Task 2.
- Old events without the new fields → `why` shows reason text and "points not recorded". Test in Task 2.
- Missing/corrupt metrics.json or a `readEvents` throw → message, not an exception. Test in Task 3.

---

### Task 1: Save score, reasons and cut-offs

**Files:**
- Modify: `clineshield/src/types/metrics.ts` (EditBlockedEvent, EditApprovalEvent, CommandAssessedEvent)
- Modify: `clineshield/src/plugin/__tests__/validateEvent.ts`
- Modify: `clineshield/src/plugin/index.ts` (`editData` callers for blocked/approval, `recordCommand`)
- Test: `clineshield/src/plugin/__tests__/rubricPlugin.test.ts`, `commandsPlugin.test.ts`

**Interfaces:**
- Produces in metrics.ts: `export interface RiskReason { rule: string; points: number; description: string }`, `export interface Cutoffs { ask: number; block: number }`; on edit-blocked/edit-approval data `score?: number; reasons?: RiskReason[]; cutoffs?: Cutoffs`; on command-assessed data `cutoffs?: Cutoffs`.

- [ ] **Step 1: Failing tests.** In `rubricPlugin.test.ts`, extend "placeholder rewrite → blocked": the `edit-blocked` event has `score` (number), `cutoffs: {ask: 40, block: 70}`, `reasons` containing `{rule: 'placeholder', points: expect.any(Number)}`, and `reason` matches none of `/\d+ points|cut-?off/i`. Extend "full rewrite of an ordinary file → asked; approval recorded": both `edit-approval` events (false then true) carry `score > 0`, `cutoffs {40,70}`, non-empty `reasons`. In `commandsPlugin.test.ts` "asked command": `command-assessed` has `cutoffs: {ask: 40, block: 70}`. In `validateEvent.ts`: when present, `score` is a number, `reasons` is `{rule, points, description}[]`, `cutoffs` has numeric `ask`/`block` (reuse the command-assessed reasons check as a helper).
- [ ] **Step 2:** `npx jest src/plugin/__tests__/rubricPlugin.test.ts src/plugin/__tests__/commandsPlugin.test.ts` → FAIL on the new fields.
- [ ] **Step 3: Implement.** Add types. In `index.ts`, a helper `scoreData(f: FileScore)` returning `{ score: f.score, reasons, cutoffs: f.cutoffs }` with reasons built exactly as in `recordRisk` (findings, `skipped:*`); spread it into the `edit-blocked` and both `edit-approval` writes. `recordRisk` reuses the same reasons builder. `recordCommand` adds `cutoffs: worstItem(decision)?.cutoffs` when defined.
- [ ] **Step 4:** `npm test` → all pass (except the known `deps/__tests__/enrich.test.ts` flake, rerun if it fails).

### Task 2: Pure report module

**Files:**
- Create: `clineshield/src/plugin/visibility/report.ts`
- Create: `clineshield/src/plugin/visibility/__tests__/fixtures/metrics.json`
- Test: `clineshield/src/plugin/visibility/__tests__/report.test.ts`

**Interfaces:**
- Consumes: `MetricsEvent`, `RiskReason`, `Cutoffs` from Task 1.
- Produces:
  - `summarize(events: MetricsEvent[], sessionId: string): Summary` where `Summary = { edits: {allowed, asked, approved, blocked: number}; commands: {asked, approved, blocked, scored: number}; riskiest: {file: string; score: number}[] }`
  - `formatSummary(s: Summary, cfg: { warnings: string[]; onErrorAllow: boolean }): string`
  - `formatWhy(events: MetricsEvent[], sessionId: string): string`
  - `formatEmpty`-free: `formatSummary` prints `No ClineShield activity in this session yet.` when every count is 0 and `riskiest` is empty (config lines still follow).
  - `export const USAGE = 'Usage: /clineshield [why]'`

Fixture (session `s1` unless noted): session-start marker; 2 `edit-allowed` single-file actions; one 2-file `edit-allowed` action (same timestamp); one 2-file ask: `edit-approval approved:false` ×2 (T1) then `approved:true` ×2 (T2), with score 55 on `src/a.ts`; one `edit-blocked` `src/auth/login.ts` score 75 with reasons + cutoffs; `risk-assessed` `src/b.ts` rulesScore 20; commands: `tier:allow` score 30, `tier:ask approved:false` then `tier:ask approved:true` (same command), `tier:block` `rm -rf /` score 100 with cutoffs (last event of s1); an old-style `edit-blocked` without new fields in session `s0`; 3 events from session `s2`.

- [ ] **Step 1: Failing tests** (`report.test.ts`, loads the fixture):
  - `summarize(ev,'s1')` → `edits {allowed: 3, asked: 1, approved: 1, blocked: 1}`, `commands {asked: 1, approved: 1, blocked: 1, scored: 1}`.
  - `riskiest` → `[{file:'src/auth/login.ts',score:75},{file:'src/a.ts',score:55},{file:'src/b.ts',score:20}]` (max per file, desc, ≤ 5, score > 0).
  - `summarize(ev,'nope')` all zero; `formatSummary` of it contains `No ClineShield activity in this session yet.`
  - `formatSummary` contains `3 allowed · 1 asked (1 approved) · 1 blocked`, `src/auth/login.ts 75`, `commands with no findings aren't logged`, `/clineshield why`; with `{warnings:['~/.cline-shield.yml: x'], onErrorAllow:true}` contains both the warning and `on_error: allow`.
  - `formatWhy(ev,'s1')` (last is the blocked command) contains `Blocked`, `rm -rf /`, `rm_outside`, `Total: 100`, `Cut-offs: ask 40 · block 70`.
  - `formatWhy` on s1 events without the command entries → the edit block for `src/auth/login.ts`, each reason line with points, `Total: 75`.
  - `formatWhy` for the 2-file ask alone → both files listed, `approved`.
  - `formatWhy(ev,'s0')` → reason text and `points not recorded`.
  - `formatWhy(ev,'s2')` with no asks/blocks → `No asks or blocks in this session.`
- [ ] **Step 2:** `npx jest src/plugin/visibility` → FAIL (module missing).
- [ ] **Step 3: Implement** in `report.ts`. Group per type by `timestamp` to count actions. Edit asks = distinct timestamps of `approved:false`; approved = distinct timestamps of `approved:true`. Commands: `block` → blocked; `ask` + `approved:false` → asked, `approved:true` → approved; `allow` → scored. `why`: walk events from the end for the last s1 `edit-blocked` / `edit-approval` / `command-assessed` with tier ≠ allow; collect all events of that type and timestamp; one block per file/command. No I/O.
- [ ] **Step 4:** `npx jest src/plugin/visibility` → PASS.

### Task 3: Register the command

**Files:**
- Modify: `clineshield/src/plugin/index.ts` (manifest, `setup`, a `runCommand(input: string): Promise<string>` on the instance)
- Test: `clineshield/src/plugin/__tests__/plugin.test.ts`
- Modify: `SPEC.md` (tick Terminal visibility boxes; Appendix row: handler gets the text after the name, reply-only output never reaches the model, runs in the session's plugin copy from CLI 3.0.74; "Later": drop "check how the CLI passes command arguments first")

**Interfaces:**
- Consumes: `summarize`, `formatSummary`, `formatWhy`, `USAGE` (Task 2); `readEvents` (`src/metrics/reader.ts`); `ConfigStore.get()`.
- Produces: `ClineShieldPlugin.runCommand(input: string): Promise<string>`; manifest capabilities `['hooks', 'commands']`; `setup` calls `api?.registerCommand?.({ name: 'clineshield', description: 'ClineShield activity for this session (why: last ask or block)', handler: runCommand })`.

- [ ] **Step 1: Failing tests** in `plugin.test.ts`: capabilities test now `['hooks','commands']`; `setup` with a fake api records one command named `clineshield`; after a blocked edit in session `s1`, `runCommand('')` contains `1 blocked` and `runCommand('why')` contains `Total:`; `runCommand('bogus')` returns `USAGE`; with an empty workspace → `No ClineShield activity`; with `readEvents` mocked to throw → returns a string starting `ClineShield: could not read activity`; a home config with an unknown key → its warning is in the output; `setup({}, ctx)` still works.
- [ ] **Step 2:** `npx jest src/plugin/__tests__/plugin.test.ts` → FAIL.
- [ ] **Step 3: Implement** `runCommand`: `await flush()`, `readEvents(workspaceRoot)`, `(store ??= new ConfigStore({homeDir})).get()`, dispatch on `input.trim().toLowerCase()` (`''` → summary, `why` → why, else USAGE); whole body in try/catch.
- [ ] **Step 4:** `npm test` in `clineshield/` → all pass; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5:** Tick SPEC boxes and fix the Appendix/"Later" lines above. Stage; commit only when the owner asks, with a body line: "metrics.json: edit-blocked/edit-approval gain optional score, reasons, cutoffs; command-assessed gains optional cutoffs".
