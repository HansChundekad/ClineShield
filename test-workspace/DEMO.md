# ClineShield Demo Guide

Open this folder in VS Code with the ClineShield extension loaded (F5 from the
main repo). Click the shield icon in the Activity Bar to open the metrics sidebar.

## Required .cline-shield.yml settings for this demo

```yaml
no-nuke:
  max_deleted_functions: 3        # Scene 1: blocks at 4+, we delete 5
  max_structural_change_lines: 10 # Risk engine guard — keep at 10
  max_structural_change_percent: 90  # Raised from 75 so Scene 5 isn't
                                     # blocked by PreToolUse before PostToolUse
                                     # risk engine gets to score it

sanity:
  tools:
    - prettier
    - eslint
    - tsc          # Scene 3: tsc must be here to catch type errors
  max_retries: 3   # Scene 3: shows the retry cycle
  timeout_seconds: 30

risk:
  protected_paths:
    - src/auth/    # Scenes 4 & 5: +30 risk points
    - src/config/  # Scene 4: +30 risk points
    - src/middleware/
    - auth/
    - config/
    - .env
    - .env.local
    - .env.production
```

After editing `.cline-shield.yml`, run `Ctrl+Shift+P → ClineShield: Reload Config`.

---

## What ClineShield protects against

| Feature | When it fires | What it does |
|---|---|---|
| **No-Nuke** | Before the edit (PreToolUse) | Blocks edits that delete too many functions or change too much structure |
| **Sanity Checker** | After the edit (PostToolUse) | Runs eslint → tsc → prettier, injects error context for Cline to fix |
| **Risk Engine** | After the edit (PostToolUse) | Scores the edit 0–100, writes risk-assessed event |
| **Metrics Sidebar** | Live, on every write | Shows session stats and the risk level of the most recent edit |
| **LLM Analysis** | *(Phase 6 — not yet implemented)* | Will add natural-language reasoning to each risk event |

---

## Scene 1 — No-Nuke blocks a destructive edit

**File:** `src/auth/userService.ts`

**Prompt to Cline:**
> "Delete the `authenticateUser`, `validateEmail`, `generateToken`, `listUsers`, and `deleteUser` functions from userService.ts"

**Expected:**
- PreToolUse detects 5 function deletions (threshold: 3)
- Edit is **blocked** — Cline receives an error message, cannot proceed
- Sidebar → Edits Blocked: +1, Most Recent Edit: `[BLOCKED]`, Risk: `—`

---

## Scene 2 — No-Nuke allows a safe edit

**File:** `src/utils/formatters.ts`

**Prompt to Cline:**
> "Add a `padLeft(str: string, length: number, char?: string): string` function to formatters.ts that left-pads a string to the given length"

**Expected:**
- PreToolUse: small patch, no deletions → **allowed**
- PostToolUse: prettier + eslint + tsc all pass → `sanity-passed`
- Sidebar → Edits Allowed: +1, Sanity Passed: +1, Risk badge: `LOW` (no protected path, small diff)

---

## Scene 3 — Sanity Checker catches a type error

**File:** `src/utils/formatters.ts`

**Prompt to Cline:**
> "Change the return type of `formatDate` to `number` and have it return the timestamp instead of a formatted string"

**Expected:**
- PreToolUse: allowed (small change, no deletions)
- PostToolUse: tsc fails — `formatDate` callers expect `string`, now gets `number`
- Cline receives a `contextModification` with the tsc error: **Attempt 1/3**
- Cline fixes the error on retry → `sanity-passed` on attempt 2
- Sidebar → Sanity Failed: +1, Avg Retries updates, then Sanity Passed: +1

*Note: if Cline can't fix it within 3 attempts, ClineShield stops injecting feedback.*

---

## Scene 4 — Risk Engine: protected path

**File:** `src/config/appConfig.ts`

**Prompt to Cline:**
> "Add a `getApiUrl(): string` function to appConfig.ts that returns config.apiBaseUrl"

**Expected:**
- PreToolUse: allowed
- PostToolUse: sanity passes, risk engine runs
- `src/config/` is a protected path → **+30 points**
- Sidebar → Most Recent Edit shows file + `Risk: 30  LOW`

---

## Scene 5 — Risk Engine: high-risk edit

**File:** `src/auth/userService.ts`

**Prompt to Cline:**
> "Rewrite the `createUser` and `updateUser` functions with thorough input validation, error handling, and logging — at least 15 lines each"

**Expected:**
- PreToolUse: allowed (no deletions, just rewrites)
- PostToolUse risk engine fires:
  - `protected_path` (+30) — `src/auth/` is protected
  - `structural_change_medium` or `_high` (+25/+40) — large rewrite, patch > 10 lines
  - Possibly `sanity_failed` (+20) if Cline introduces an error
- Sidebar → Risk badge: `MEDIUM` or `HIGH`

---

## Scene 6 — Metrics Sidebar live update

After running scenes 1–5 the sidebar should show something like:

```
Session Stats
  Edits Blocked   1
  Edits Allowed   4
  Sanity Passed   3
  Sanity Failed   1
  Avg Retries     1.0

Most Recent Edit
  src/auth/userService.ts
  [ALLOWED]
  just now
  Risk: 55  MEDIUM
```

The panel updates within 1–2 seconds of any write to `.cline-shield/metrics.json`.

---

## What the demo does NOT show (by design)

- **Class method deletions**: PreToolUse uses regex-based function detection.
  Class method syntax (`methodName() {}`) is not matched — `src/models/product.ts`
  is a PostToolUse target only (tsc/eslint catch errors there, not PreToolUse).
- **LLM analysis**: Phase 6, not yet implemented.
