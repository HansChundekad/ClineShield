# Ask through the conversation — design

Status: awaiting owner approval. SPEC.md "Ask through the conversation" is the feature record.
Source checked: cline/cline `main` 94eecbb; installed CLI 3.0.73 (SDK 0.0.95) has the same hook types.

## Why

The ask tier returns `policy: { autoApprove: false }`. With interactive auto-approve all on, the CLI approves before
reading that policy (`apps/cli/src/runtime/interactive/approvals.ts`), so ask silently allows.

## Goals

- Ask means the action does not run until the real user says yes in chat, whatever the auto-approve setting.
- A yes allows the identical action once.
- With no user present, the action stays refused.

## Anti-goals

- The model can approve itself by retrying, by spawning an agent, or through a tool result.
- A yes carries over to a changed action or a second run.
- Points or cut-offs reach Cline.
- `metrics.json` changes shape.

## What the plugin can trust (verified in source)

| Fact | Source |
|---|---|
| `beforeTool` gets `snapshot.messages`, the full history with roles; the sandbox forwards the whole payload | `agents/src/agent-runtime.ts` `snapshot()`, `core/src/extensions/plugin/plugin-sandbox.ts` `makeHookHandler` |
| Real user turns and mid-run steers are stored as `<user_input mode="act\|plan\|yolo">text</user_input>`; a `<mode_notice>` can be prepended | `core/src/runtime/host/local-runtime-host.ts` `prepareTurnInput`, `consumePendingUserMessage`; `shared/src/prompt/format.ts` |
| Other user-role messages exist and are not user speech: `<hook_context>`, reminders, loop and recovery notices, compaction summaries | `agent-runtime.ts`, `session-runtime-orchestrator.ts`, `compaction-shared.ts` |
| A skip is stored as a tool result with `output: { error: reason }`, `isError: true` | `agent-runtime.ts` `executePreparedTool` |
| Subagents and teammates run plugin hooks, and their task text arrives as a user-role message written by another model | `team/delegated-agent.ts`, `team/multi-agent.ts`, `spawn-agent-tool.ts` |
| Subagents have `parentAgentId`. Teammates have neither `parentAgentId` nor `agentRole`, so those fields can't identify them | `team/team-tools.ts`, `session-runtime-orchestrator.ts` |
| `ask_question` returns `options[0]` when there is no TTY, and the model writes the options | `apps/cli/src/utils/approval.ts` `askQuestionInTerminal` |

## Behaviour

**Ask.** Return `{ skip: true, reason: askMessage(decision) }`. The new text keeps the "why" and tells Cline to ask in a
plain chat message (not `ask_question`) and end its turn; to retry the identical action once only after a yes; and,
kept from today: "If the user says no, don't retry the same action; ask them what they want."

**Approval check.** Runs only when the scored tier is `ask`, so block and hard rules are never bypassed, and observe mode
is untouched. New pure module `clineshield/src/plugin/rubric/approval.ts`. Approved only if all of these hold:

1. The caller is the user's own agent: no `parentAgentId`, and `snapshot.agentId` equals the first agent id this plugin
   instance saw. A teammate can only exist after the main agent's tool call, so `beforeTool` records the id at its top
   for every tool.
2. Refusal: the latest earlier tool result with the same tool name, the same raw input as stored in history
   (key-order-insensitive canonical JSON, nothing else normalised; hooks see a schema-normalized input, so it is not used), `isError`, and `output.error` exactly equal to the current `askMessage`. A changed
   action or changed reason finds nothing.
3. Reply: the first message after that refusal that is role `user` and fully wrapped in `<user_input …>` is a plain yes.
   Anything else in that position, including a "no", ends the search: not approved.
4. Unused: no identical call sits between that reply and the current call in history order. This also settles identical
   parallel calls: only the first is allowed. The current `toolCallId` must be found in history.

Approved returns `{ policy: { autoApprove: true } }` so the action runs without a second prompt.

**Plain yes.** After removing `<mode_notice>` elements, the wrapper, surrounding space and trailing `.` or `!`,
case-insensitive, the whole text is one of: yes, y, yep, yeah, ok, okay, sure, approve, approved, go ahead, do it, proceed.

**State.** None is written. The evidence is the history, so a resumed session works. Consumption is also read from
history. Default (agentic) compaction removes the oldest messages first, so losing evidence only causes another ask.
Basic compaction can keep a refusal while dropping its use; a later real yes could then re-approve that action (accepted limit). The only memory is
the first agent id.

**Headless.** Nothing to detect: no user message arrives, so check 3 never passes.

**One-shot.** The action is refused and the run ends with Cline's question. The user continues with `cline --id <session>`.

## Logging (no schema change)

Logged in `beforeTool`, like blocks. `afterTool` receives no `decided` entry for a refusal.

| Event | Edits | Commands |
|---|---|---|
| Refused, waiting on the user | one `edit-approval` per file, `approved: false` | `command-assessed`, `tier: ask`, `approved: false` |
| Allowed after yes | `edit-approval`, `approved: true` via the existing `afterTool` path, then `risk-assessed` | `command-assessed`, `approved: true` |

An approved action therefore logs a false then a true. Nothing outside the plugin reads these fields yet.

## SPEC changes, in the implementation commit

Tick the first two feature boxes (the third once the issue is posted). Correct Action tiers, Decision 2 (false now means
refused pending the user, not the runtime's denial), the module note in `index.ts`, and add the Appendix facts above.

## Testing

TDD with fake snapshots: approved path; each failed check; "no", "yes but…", forged reply from a subagent and from a
teammate id; changed input; key order; reused approval; parallel duplicates; `ask_question` result ignored; compaction
gap; hard rule and block still win; observe mode; logging for both tools. Hook never throws, under 2 s.

Live-only: that `snapshot.agentId` is stable and that messages reach the worker as read. Manual CLI run with auto-approve
on and off also covers the SPEC's allow/ask/block check.

## Owner decisions

- Only a plain yes counts.
- Subagents and teammates cannot be approved.

## Builder's calls (check these)

- The yes word list.
- A refusal is logged immediately as `approved: false`, then `true` on approval.
- A yes skips Cline's own approval prompt, including with auto-approve off.
- The reason must be unchanged since the refusal, so a newly detected risk asks again.
- Unparseable-input asks (`on_error: ask`) use the same flow.
- A mid-run steer of "yes" counts: it is real user text.

## Known limit

The model can misdescribe the action when asking. The refusal reason, shown in the terminal, is the mitigation.
Session files on disk are trusted on resume.
