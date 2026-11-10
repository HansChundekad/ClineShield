# Terminal visibility (`/clineshield`) — design

Status: approved in chat by the owner 2026-11-09. SPEC.md "Terminal visibility" is the feature record.
Source checked: cline/cline `main` 1e8ae47; CLI 3.0.74 ships `@cline/core` 0.2.0 with the same command path.

## Why

CLI users have no way to see what ClineShield did in a session or why it asked or blocked. Cline itself only gets
the reason sentence, never points or cut-offs (so it can't learn to slip under them). The user should see the full numbers.

## Goals

- `/clineshield`: this session's allowed / asked / blocked counts, the riskiest files, config warnings, an `on_error: allow` notice.
- `/clineshield why`: the session's last ask or block in full: every category, its points, the total, the ask and block cut-offs.
- Quick on a large `metrics.json`; never throws; clear message with no events.

## Non-goals

- `/clineshield init` / `preset` (SPEC "Later").
- Observe-mode "would have asked/blocked" in `why` (builder's call, left out).
- Changing what Cline sees.

## Anti-goals

- Command output reaching the model.
- One action counted twice (multi-file edits; ask refused then approved).
- Events from other sessions mixed in.

## Platform facts (verified in source)

| Fact | Source |
|---|---|
| Handler is `(input: string) => string \| {reply?, submitPrompt?}`; `input` is the text after `/name`, trimmed, so `/clineshield why` → `"why"` | `sdk/packages/shared/src/extensions/contribution-registry.ts`; `core/src/services/plugin-command-api.ts` `parsePluginCommand` |
| A reply-only result is shown in the terminal and the turn ends with 0 tokens; nothing enters the conversation. Only `submitPrompt` is sent to the model | `apps/cli/src/runtime/interactive/chat-command-runner.ts`, `run-interactive.ts` |
| With a session id, the command runs in that session's own plugin copy (`withSessionPluginCommands`), so `setup`'s `ctx.session.sessionId` is the current session. CLI 3.0.73 used a separate per-workspace copy; needs 3.0.74+ | `core/src/runtime/host/local-runtime-host.ts` |
| Requires `"commands"` in `manifest.capabilities`; registration only in `setup` | plugin REFERENCE.md |

## Schema change (owner decision 2026-11-09)

The logs lacked what `why` needs: edit asks/blocks stored only the reason sentence, commands lacked the cut-off.
Additive, optional fields in `clineshield/src/types/metrics.ts` (old events stay valid; readers that ignore them are unaffected):

- `edit-blocked`, `edit-approval`: `score?: number` (that file's score), `reasons?: {rule, points, description}[]`
  (same shape and content as `risk-assessed`), `cutoffs?: {ask: number, block: number}` (that file's effective cut-offs).
- `command-assessed`: `cutoffs?: {ask, block}` (the deciding item's cut-offs).

Written for every new event of those types (both the refused and the approved `edit-approval`). Never in the reason text.
**Other agents (VS Code extension) must be told** in the commit message and the final report.

## Behaviour

**Session scope:** events with `sessionId` = the plugin's session id. One `readEvents()` per run.

**Counting (pure module):**
- Edits: group events by `timestamp` (one action's per-file events share it). `edit-allowed` (minus `file: session-start`) → allowed;
  `edit-blocked` → blocked; `edit-approval approved:false` → asked; `approved:true` → marks that ask approved, not a new action.
  Observe-mode actions are logged as `edit-allowed` and count as allowed.
- Commands: `command-assessed` `tier: block` → blocked; `tier: ask` with `approved:false` → asked; `approved:true` → approved, not new;
  `tier: allow` → scored. Allowed commands with no findings are never logged, so the summary says commands are counted only when scored.
- Riskiest files: highest score per file from `risk-assessed.rulesScore` and the new `score` on `edit-blocked`/`edit-approval`;
  top 5 with score > 0, highest first.

**Output (`/clineshield`), plain text:**
```
ClineShield — this session
Edits:    12 allowed · 2 asked (1 approved) · 1 blocked
Commands: 1 asked · 1 blocked · 3 allowed with findings (commands with no findings aren't logged)
Riskiest files: src/auth/login.ts 75 · .env 45 · …
Config: ~/.cline-shield.yml: unknown key "foo" ignored
Note: on_error: allow — if ClineShield fails, actions run unchecked
Run /clineshield why for the last ask or block.
```
No events: `No ClineShield activity in this session yet.` (config lines still shown).

**Output (`/clineshield why`):** the last edit-blocked / edit-approval / command-assessed with tier ask or block, by array order
(all events of one action share a timestamp and are shown together). Shows tier and, for asks, refused or approved; file(s) or command; then each reason `rule  points  description`, `Total: N`, `Cut-offs: ask A · block B`.
A multi-file edit lists each file's block. Events written before this change: reason text plus "points not recorded (logged
before ClineShield recorded them)". None: `No asks or blocks in this session.` Unknown argument: short usage line.

**Config lines:** from `ConfigStore.get()` at command time (warnings + `config.onError === 'allow'`), so they show before any action.

**Never throws:** the handler catches everything and returns `ClineShield: could not read activity (<message>)`.

## Code layout

- `clineshield/src/plugin/visibility/report.ts` — pure: `summarize(events, sessionId)`, `formatSummary(...)`, `formatWhy(events, sessionId)`. Own tests with a fixture `metrics.json`.
- `clineshield/src/plugin/index.ts` — add `"commands"`, `api.registerCommand({name: 'clineshield', …})` in `setup`, and pass `score`/`reasons`/`cutoffs` when writing the events above. Keep the change small (other agents touch this file).
- `clineshield/src/plugin/__tests__/validateEvent.ts` — check the new optional fields' types.

## Left to the builder

Exact wording and alignment, fixture contents, helper names.
