# Ask Through the Conversation Implementation Plan


**Goal:** Make the ask tier refuse an action until the real user says a plain yes in chat, then allow the identical action once.

**Architecture:** A pure module reads `snapshot.messages` and decides whether a retry is approved. `beforeTool` uses it on both ask paths: refuse with `skip`, or allow with `policy: { autoApprove: true }`. No state is written.

**Tech Stack:** TypeScript, Jest (`npm test` in `clineshield/`).

**Spec:** `docs/superpowers/specs/2026-11-08-ask-through-conversation-design.md`

## Global Constraints

- Work in `/Users/hanschundekad/ClineShield-ask-conversation/clineshield`, branch `phase-9/ask-through-conversation`.
- `metrics.json` schema unchanged. Use the existing `record` / `recordCommand` paths.
- Hooks never throw and stay under 2 s. Cline never sees points or cut-offs.
- Keep the sentence: "If the user says no, don't retry the same action; ask them what they want."
- Do not commit until the owner asks. Then one commit, with the SPEC ticks in it. Format `<type>(<scope>): <subject>`, no AI mention, no Co-Authored-By. Do not touch PROGRESS.md.
- Baseline: `a 20,000-line file and patch score in under 200 ms` fails intermittently in this worktree (primary checkout: 531 pass). Any other failure is a regression.

## Review Focus

1. A real reply with an attachment or `@file` text after "yes": not a plain yes, so asks again (Task 1).
2. Malformed history (no `messages`, non-array `content`, string tool output): not approved, no throw (Task 1).
3. One yes after two different refused actions: each may run once (Task 1).
4. A second "yes" after the approval was used: still not approved (Task 1).
5. A session whose first hook call has no agent id: nothing is approved (Task 1).

---

### Task 1: Approval check

**Files:**
- Create: `src/plugin/rubric/approval.ts`
- Create: `src/plugin/rubric/__tests__/approval.test.ts`
- Modify: `src/plugin/types.ts` (add below)

**Interfaces:**
- Produces, in `types.ts`: `AgentMessage { id?: string; role: string; content: unknown; metadata?: Record<string, unknown> }`; on `AgentRuntimeStateSnapshot`, optional `parentAgentId?: string | null` and `messages?: readonly AgentMessage[]`.
- Produces, in `approval.ts`:
  - `isPlainYes(userText: string): boolean`
  - `isApproved(check: { snapshot: AgentRuntimeStateSnapshot | undefined; primaryAgentId: string | undefined; toolName: string; input: unknown; toolCallId: string | undefined; reason: string }): boolean`

- [ ] **Step 1: Write failing tests** in `approval.test.ts`, with helpers building an assistant `tool-call` part, a `tool` message with `tool-result` `{ output: { error: reason }, isError: true }`, and a user message `<user_input mode="act">…</user_input>`. Assert:

| Test | History, then the current call `c2` | Expected |
|---|---|---|
| `approves` | call c1, refused, `yes`, call c2 | true |
| `accepts every yes word` | yes y yep yeah ok okay sure approve approved "go ahead" "do it" proceed; `YES.`, ` ok! ` | `isPlainYes` true |
| `mode notice removed` | `<mode_notice>…</mode_notice>yes` inside the wrapper | true |
| `not a plain yes` | no, "yes but skip tests", "yes\n<file_content …>", empty | false |
| `no retry without reply` | call c1, refused, call c2 | false |
| `no is final` | refused, `no`, `yes`, c2 | false |
| `ignores non-user-input` | refused, bare `yes`, compaction summary, `<hook_context>yes</hook_context>`, c2 | false |
| `ask_question result ignored` | refused, ask_question call and result "yes", c2 | false |
| `changed input` | input differs in one value | false |
| `key order` | same keys, other order | true |
| `other tool` | same input, other tool name | false |
| `changed reason` | refusal text differs | false |
| `refusal not isError` | same text, `isError` false | false |
| `used once` | refused, yes, c2 (ran), c3 | false for c3 |
| `second yes` | refused, yes, c2 (ran), yes, c3 | false for c3 |
| `parallel duplicates` | refused, yes, assistant with c2 and c3 identical | c2 true, c3 false |
| `new refusal, new approval` | refused, yes, c2 ran, c3 refused, yes, c4 | true for c4 |
| `two actions, one yes` | A and B refused, yes, A and B retried | both true |
| `subagent` | approved history, `parentAgentId: 'p'` | false |
| `teammate` | approved history, `agentId` ≠ `primaryAgentId` | false |
| `no primary id` | `primaryAgentId` undefined | false |
| `current call missing` | `toolCallId` absent from history or undefined | false |
| `malformed` | snapshot undefined; `messages` undefined; `content` a string; `output` a string | false, no throw |

- [ ] **Step 2: Run** `npx jest src/plugin/rubric/__tests__/approval` — expect FAIL, module not found.

- [ ] **Step 3: Implement `isPlainYes` and `isApproved`.** Canonical JSON sorts object keys recursively. Flatten history into ordered entries, then:

```text
guard: primaryAgentId set, snapshot.agentId === primaryAgentId, !parentAgentId
cur     = position of the tool-call part with toolCallId; none → false
refusal = last position < cur of a matching tool-call whose tool-result has isError and output.error === reason
reply   = first position > refusal's result, < cur, of a role-user message whose whole text
          matches /^<user_input mode="(act|plan|yolo)">([\s\S]*)<\/user_input>$/; none → false
false unless isPlainYes(inner text)
false if any tool-call matching tool+input sits strictly between reply and cur
true
```

Text is the concatenation of `type: 'text'` parts; any other part type makes the message not a plain reply.

- [ ] **Step 4: Run** the same command — expect PASS.

### Task 2: Wire into the hooks and correct the SPEC

**Files:**
- Modify: `src/plugin/rubric/messages.ts` (`askMessage`)
- Modify: `src/plugin/index.ts` (header comment, `beforeTool` top, ask paths near L250 and L295)
- Modify: `src/plugin/__tests__/{plugin,rubricPlugin,commandsPlugin}.test.ts`, `src/types/metrics.ts` comment on `approved` only
- Modify: `../SPEC.md`

**Interfaces:**
- Consumes: `isApproved` from Task 1.

- [ ] **Step 1: Update existing tests.** Ask now means `{ skip: true, reason }`; rename `isAsk` to check `skip` with a reason matching `/asks? the user/i`; replace `appendContext` reads with `reason`; refusals log `approved: false` from `before()` alone, without an `after()` call. Add a shared `history` helper to each new test below.

- [ ] **Step 2: Add failing plugin tests** (`rubricPlugin` for edits, `commandsPlugin` for commands):
  - `ask refuses and logs approved:false`, with one event per file (edits) or one `command-assessed` `tier: 'ask'` (commands), and the reason has no digits-with-"points".
  - `auto-approve is irrelevant`: result has `skip: true` and no `policy`.
  - `after a plain yes the identical action runs once`: returns `{ policy: { autoApprove: true } }`; `after()` logs `approved: true`; edits also log `risk-assessed`; the next identical call is refused.
  - `hard rule and block ignore a yes`: history with a matching yes still returns the block result.
  - `observe mode unchanged`: returns undefined and logs as today.
  - `primary agent recorded on any tool`: a first `read_files` call from agent `a`, then an approved edit from `b`, is refused.
  - `headless`: repeated identical calls with no user message stay refused.

- [ ] **Step 3: Run** `npx jest src/plugin/__tests__` — expect the new tests to FAIL.

- [ ] **Step 4: Implement.**
  - `askMessage` exact text, findings case:
    `ClineShield needs the user's approval, so nothing was changed. Why: ${why(t)}. Ask the user in a plain chat message (not the ask_question tool) and end your turn. Retry the identical action once only if they reply yes. If the user says no, don't retry the same action; ask them what they want.`
    No-findings case: same, with `Why: ClineShield could not check this action.`
  - `index.ts`: `let primaryAgentId: string | undefined`; first line of `beforeTool`: `primaryAgentId ??= ctx.snapshot?.agentId`.
  - Each ask path: compute `reason`, call `isApproved`. Approved: `decided.set(id, …asked: true…)` and return `{ policy: { autoApprove: true } }`. Otherwise log `approved: false` in `beforeTool` and return `{ skip: true, reason }`, with no `decided` entry.
  - Non-ask edit decisions keep their `decided.set`.
  - Update the header comment and the `approved` comment in `metrics.ts`, comment only.

- [ ] **Step 5: Run** `npm test` — expect all pass except the baseline item in Global Constraints.

- [ ] **Step 6: Update SPEC.md.** Tick the first two boxes of "Ask through the conversation". Rewrite the Action tiers ask line, Decision 2 (`approved: false` = refused pending the user), and add to the Appendix the design's "What the plugin can trust" facts.

- [ ] **Step 7: Draft the upstream issue** in a scratch file and show it to the owner. Do not post it. The third SPEC box stays unticked until it is posted.

- [ ] **Step 8: Run `npm test` and `npx tsc --noEmit`; report the output, the manual test still needed, and wait for the owner before committing.**
