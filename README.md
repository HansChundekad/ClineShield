# Features Demo Script

### YAML Config

ClineShield is configured through a `.cline-shield.yml` file in your project root. When the extension starts, it automatically reads this file and applies your settings to both safety hooks — no environment variables or manual setup required.

The configuration is divided into 4 sections:

- **no-nuke** — Sets thresholds for destructive edits, such as function deletions or large structural changes, which can trigger PreToolUse protection.
- **sanity** — Defines validation behavior, including which tools to run (Prettier, ESLint, TypeScript), retry limits, and per-tool timeouts.
- **risk** — Specifies protected files and directories that add additional weight to the risk score.
- Gemini api key - users will paste their api key in here to access the LLM analysis feature.

The config file is gitignored by default, allowing each developer to adjust safety thresholds locally without affecting the team.

---

**Hooks Automation**

ClineShield provides a **Generate Hooks** command that installs the required PreToolUse and PostToolUse scripts directly into `.clinerules/hooks/`.

Install the extension, add your YAML configuration, and run **Generate Hooks** — protection is applied automatically. No manual script placement or additional setup required.

## No-Nuke Hook (Blocks Destructive Edits)

Before Cline writes to any file, this hook intercepts the edit and checks if the change is too destructive. It parses the patch Cline sends — scanning added and deleted lines — counting how many functions were deleted, exports removed and what percentage of the file changed overall. If thresholds exceed the configurations, the hook blocks the edit and tells Cline to make a smaller, more targeted change instead.

## Sanity Check Hook

Once the No-Nuke check is passed Cline successfully edits a file, this hook runs prettier, then eslint, then TypeScript compilation using `tsc --noEmit`, which performs full type-checking without generating any build output. The pipeline stops on the first failure. If everything passes, the edit is marked clean. If a check fails, the hook injects the exact tool output into Cline's conversation telling it to fix only those errors. This repeats up to 3 times per task (but is configurable in the YAML file). After 3 failed attempts the hook stops sending feedback — it writes the failure to the metrics dashboard but otherwise gets out of the way. 

Note: This is best-effort guidance, not a guaranteed fix loop as Cline usually acts on the tool feedback, but the model ultimately controls what happens. 

## Rules Engine

The rules engine runs inside the PostToolUse hook, acting as a lightweight safety layer that evaluates every edit and assigns a risk score from 0 to 100.

Scores are influenced by factors such as:

- Modifications to protected files or directories

• Large structural changes

• Function deletions

• Failed validation checks

• Unusually large diffs

This scoring system is deterministic and rule-based, ensuring predictable behavior independent of any LLM analysis.

---

## LLM risk explanation

When an edit produces a medium or high risk score, the extension can optionally invoke Gemini 2.5 Flash to generate a plain-English explanation of why the change may be risky.

The model receives:

- The actual diff

• Post-edit file contents

Importantly, the rules engine determines the score — the LLM only provides human-readable context.

If no API key is configured, LLM analysis is skipped and rules-only scoring remains fully functional.

## Change Map

The change map answers a question the metrics sidebar can’t: which files has Cline touched most, and how risky were those edits?

The sidebar shows session totals, like “3 edits blocked” or “2 sanity failures,” but it doesn’t show where the activity actually happened.

The change map gives you a quick view:

- **src/auth/** is red → high-risk changes
- **src/utils.ts** is green → low-risk edits
- **src/auth/service.ts** shows 4 edits → repeatedly modified

**Use case:** at the end of a session, you can prioritize review by opening the change map, sorting by risk color, and clicking through files in order — a ready-made, prioritized review queue based on Cline’s actual edits.
