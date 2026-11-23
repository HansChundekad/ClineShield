<p align="center">
  <img src="assets/brand/clineshield-header.gif" alt="ClineShield" width="600">
</p>

<p align="center">
  <b>A safety plugin for Cline.</b> Every action gets scored before it runs: allow, ask or block.
</p>

<p align="center">
  In 50 real Cline runs it caught <b>6 of 10</b> destructive actions the models attempted, with <b>4 false alarms in 148</b> safe actions.
  <a href="#evaluation">How we measured it ↓</a>
</p>

<p align="center">
  <a href="https://github.com/HansChundekad/ClineShield/actions/workflows/ci.yml"><img src="https://github.com/HansChundekad/ClineShield/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Cline%20CLI-3.0.74%2B-555" alt="Cline CLI 3.0.74+">
  <!-- RELEASE DAY: uncomment once the extension is live on both registries.
  <a href="https://marketplace.visualstudio.com/items?itemName=clineshield.clineshield"><img src="https://img.shields.io/visual-studio-marketplace/v/clineshield.clineshield?label=VS%20Code%20Marketplace" alt="VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/clineshield/clineshield"><img src="https://img.shields.io/open-vsx/v/clineshield/clineshield?label=Open%20VSX" alt="Open VSX"></a>
  -->
</p>

<!-- DEMO VIDEO PLACEHOLDER: replace this comment with a linked thumbnail, e.g.
<p align="center"><a href="https://www.youtube.com/watch?v=VIDEO_ID"><img src="assets/demo/video-thumbnail.png" alt="Watch the ClineShield demo" width="720"></a></p>
-->

## Install

**1. The plugin** does the guarding:

```sh
cline plugin install https://github.com/HansChundekad/ClineShield
```

It works with zero configuration (the `balanced` preset). Your next Cline session is guarded.

**2. The VS Code extension** is optional, but highly recommended. A live sidebar shows what's waiting on you, every
allow / ask / block as it happens, and a map of every file Cline touched. If the plugin isn't installed yet, the
sidebar shows the command above with a Copy button. Works in VS Code and its forks.

- **VS Code Marketplace:** search for **ClineShield** in the Extensions view.
- **Open VSX** (Cursor, Windsurf, VSCodium): search for **ClineShield** in the Extensions view.
- **VSIX file:** download the `.vsix` from the [latest release](https://github.com/HansChundekad/ClineShield/releases/latest),
  then run **Extensions: Install from VSIX…** from the command palette.

> [!IMPORTANT]
> ClineShield runs where Cline runs plugins: the **Cline CLI**, the **Cline SDK** and **Kanban**.
> It does **not** run in Cline inside VS Code or JetBrains (no plugin support there yet) or in Cline Desktop
> (plugin hooks don't fire, tracked in [cline/cline#14593](https://github.com/cline/cline/issues/14593)).
> `/clineshield` needs Cline CLI 3.0.74 or newer. Tested on macOS and Linux (Docker).

## What you'll see

Before every file edit, delete, move, shell command or dependency install, ClineShield scores the risk and answers:

| | What happens |
|---|---|
| ✅ **Allow** | The action runs. Most actions land here. |
| 🟡 **Ask** | Nothing runs yet. Cline asks you in the chat; reply **yes** and the identical action runs once. |
| 🛑 **Block** | Nothing runs. Cline is told why and what to do instead, and keeps working on your task. |

<!-- TERMINAL GIF: recorded with vhs from assets/demo/terminal.tape -->
<p align="center"><img src="assets/demo/terminal.gif" alt="Cline tries to delete a folder outside the project; ClineShield blocks it and /clineshield shows the summary" width="760"></p>

When an action is blocked, this is what Cline reads (it never sees points or cut-offs, so it can't learn to slip
under them):

```text
ClineShield blocked this action, so nothing was changed. Why: deletes ../old-backups recursively, outside
the project. Fix: Only delete inside the project folder (temp folders are fine); ask the user to do anything
else by hand. Don't retry the same change in smaller pieces to get around this.
```

Type **`/clineshield`** in Cline for this session's allowed / asked / blocked counts and riskiest files, or
**`/clineshield why`** for the last ask or block in full (every category, its points, the total and the cut-off).
That output stays in your terminal and never enters the conversation.

Everything is also logged to `.cline-shield/metrics.json` in your project, and the VS Code extension shows it live:

<!-- SCREENSHOT PLACEHOLDER: assets/screenshots/sidebar.png
<p align="center"><img src="assets/screenshots/sidebar.png" alt="ClineShield sidebar: Waiting on you, totals and recent actions" width="380"></p>
-->

## VS Code extension

The plugin does all the guarding; the extension is a live dashboard for the same log (install it from
[Install](#install), step 2). **What it shows**, in the ClineShield view of the activity bar:

- **Waiting on you:** asks you haven't answered and the latest block, with every category, its points, the total
  and the cut-off. The status bar shows how many are waiting.
- **Totals** and **Recent activity** (last 15 actions): asks you approved ✓ or declined ✗.
- **Settings:** your preset, mode and config file, with Open config / Create config.
- **Change map:** every file Cline touched, coloured by its worst risk; files with a blocked attempt are marked.

<!-- SCREENSHOT PLACEHOLDER: assets/screenshots/change-map.png
<p align="center"><img src="assets/screenshots/change-map.png" alt="ClineShield change map" width="380"></p>
-->

**Explanations (opt-in).** Run **ClineShield: Set Gemini API Key**, then click **Explain** on an action for a
plain-English explanation from Gemini. Nothing is sent until you click; the key is kept in VS Code's secret storage
(never in a file), and secrets are stripped from code before it is sent. **ClineShield: Clear Gemini API Key**
turns it off. Everything else works without a key.

## Configuration

No config file is needed. To change anything, create **`~/.cline-shield.yml` in your home folder**; it applies
to every repo. A `.cline-shield.yml` inside a repo is never read, so a cloned repo can't loosen your settings.
Changes apply on Cline's next action.

The settings most people want (from [.cline-shield.example.yml](.cline-shield.example.yml)):

```yaml
preset: balanced       # relaxed (60/90) | balanced (40/70) | strict (25/50)
mode: enforce          # enforce | observe (log asks/blocks; hard rules still block)
# protected_paths: ["src/payments/**"]
# trusted_commands: ["npm test", "make build"]   # never scored
```

The VS Code extension's **Create config** writes the file with every setting listed. Bad values never break
anything: an unknown key is ignored, a bad value falls back to its default, and either way you get a warning in
`/clineshield`.

<details>
<summary><b>Every config key</b></summary>

| Key | Values | What it does |
|---|---|---|
| `mode` | `enforce` (default) · `observe` | `observe` only logs what it would have asked or blocked. Hard rules still block. |
| `preset` | `relaxed` · `balanced` (default) · `strict` | Ask / block cut-offs: 60 / 90, 40 / 70, 25 / 50. |
| `on_error` | `ask` (default) · `allow` | What happens if ClineShield itself fails. `allow` lets the action run unchecked (and says so). |
| `offline` | `false` (default) · `true` | `true` = no package-registry lookups. Lookalike-name and new-registry checks still run. |
| `cutoffs` | `{ ask: 0–100, block: 0–100 }` | Override the preset's cut-offs (ask < block). |
| `categories` | `<id>: points \| off \| block` | Change any category's points, turn it off, or make it always block. |
| `protected_paths` | list of globs | Paths that add points when touched. Setting it replaces the defaults (`src/auth/**`, `src/config/**`, `src/middleware/**`, `auth/**`, `config/**`). CODEOWNERS paths are always protected. |
| `trusted_commands` | list of commands | Exact command pieces that are never scored. |
| `trusted_domains` | list of hosts | Hosts that don't count as a new domain in code. |
| `paths` | `"<glob>": { preset, cutoffs, categories }` | Per-folder overrides; the first matching glob wins. |
| `custom_rules` | `{ match: path \| content \| command, pattern, points \| block, message }` | Your own rules. Patterns up to 200 characters; repeated groups like `(…)+` are rejected. |

Hard rules (self-protection, placeholder rewrites, secrets added, deleting outside the project) can't be configured.
The fully commented file is [.cline-shield.example.yml](.cline-shield.example.yml). Never put API keys in it: the
Gemini key lives in the VS Code extension.

</details>

## Built on the Cline SDK

ClineShield is an `AgentPlugin` for the Cline SDK. It hooks two points of Cline's agent loop:

- **`beforeTool`** scores the action and decides. To ask or block, it returns `{ skip: true, reason }`: that one
  tool call is skipped and Cline gets the reason as the tool's result, so **the task keeps going** instead of
  ending. Cline can pick a safer approach or ask you.
- **`afterTool`** records what actually happened (and scores the change after a successful edit).

Cline gives plugin hooks 3 seconds and then **fails open** (the action runs unchecked). ClineShield keeps its own
**2-second internal deadline**, runs the cheap, important checks first and usually decides in under a
millisecond (replay median 0.42 ms, p95 4.13 ms, without Cline's own overhead). It never throws: an internal error falls back to your `on_error` setting.

## How it works

```mermaid
flowchart TD
    A["Cline wants to run a tool<br/>(edit · delete · move · command · install)"] --> B{"beforeTool<br/>ClineShield rubric"}
    B -- allow --> C["Tool runs"]
    B -- ask --> D["Skipped · Cline asks you in chat"]
    D -- "you reply yes" --> C
    B -- block --> E["Skipped with a reason<br/>Cline keeps working"]
    C --> F["afterTool<br/>record outcome · score the edit"]
    B --> G[(".cline-shield/metrics.json")]
    F --> G
    G --> H["/clineshield<br/>in the terminal"]
    G --> I["VS Code extension<br/>(optional)"]
```

### Scoring

One rubric scores every kind of action, in any language:

1. **Categories add points.** Each category that fires (a file deleted, tests skipped, `sudo`, a secrets file
   touched…) adds its points. Edits are measured against the **real file**: before anything is written,
   ClineShield reads the file, applies Cline's change in memory and compares.
2. **Groups keep it fair.** Categories belong to risk groups (lost code, file operations, unrecoverable, sensitive
   location, dependencies, weakening safety, content, privilege, external…). Per file, each group counts only its
   biggest finding, so one problem isn't counted three times.
3. **The total picks the tier.** The total is capped at 100 and compared with the preset's cut-offs. On `relaxed`
   and `balanced`, a block also needs two or more groups to score; `strict` blocks at the cut-off alone. When one
   action touches several files, the worst file decides.
4. **Hard rules always block,** whatever the score and even in observe mode: changing ClineShield's own config,
   placeholder rewrites ("rest of code unchanged"), adding a secret, and recursive deletes outside the project.

| Preset | Ask at | Block at |
|---|---|---|
| relaxed | 60 | 90 |
| **balanced** (default) | **40** | **70** |
| strict | 25 | 50 |

**Commands** are parsed, not pattern-matched as one string: chains, pipes, `sudo`, `VAR=x`, one level of
`bash -c` and `$(…)` are unwrapped, `cd` is followed so relative paths resolve, and quoted text, heredocs and
comments never match. A command that writes a file is scored like an edit of that file. **Dependencies** (npm and
PyPI, in manifests or `npm install` / `pip install`) are checked against the public registry for packages that
don't exist and for lookalike names.

<details>
<summary><b>The full rubric (categories and points)</b></summary>

Points are the defaults; all except hard rules can be changed with `categories`. Exact definitions are in
[SPEC.md › Risk rubric](SPEC.md#risk-rubric).

| Group | Categories (points) |
|---|---|
| **Hard rules** (always block) | `self_protection` · `placeholder` · `secret_added` · `rm_outside` |
| **Lost code** | `rewrite_share` (≥ 40 %: 25 · ≥ 75 %: 50) · `lines_removed` (> 100: 15 · > 300: 30) · `functions_removed` (10 each, max 40) · `exports_removed` (20 each, max 40) |
| **Scope** | `files_touched` (> 5: 15 · > 15: 30) |
| **File operations** | `file_deleted` (35) · `move_overwrites` (40) · `outside_workspace` (50) · `rm_recursive` (20; build folders like `node_modules`, `dist` = 0) · `shell_edit` (15) · `unknown_target` (40). A tracked, clean file git can restore: −10 |
| **Unrecoverable** | `uncommitted_lost` (+30) · `discards_work` (50 dirty tree · 10 clean) · `history_rewrite` (50, any forced push incl. `--force-with-lease`) |
| **Sensitive location** | `secrets_file` (45) · `ci_config` (35) · `infra` (30) · `migration` (30) · `protected_path` (30) · `gitignore_changed` (15) · `gitignore_unignores_secrets` (60) · `generated` (20) |
| **Dependencies** | `dep_missing` (80) · `dep_typosquat` (50) · `dep_new_registry` (45) · `dep_install_scripts` (30) · `dep_unverified` (10) · `manifest` (15) |
| **Weakening safety** | `tests_deleted` (40) · `tests_skipped` (30) · `checks_disabled` (20) · `assertions_weakened` (30) · `expected_changed` (25) · `test_and_source` (15 · 30 after a failed test run) |
| **Content** (added lines) | `auth_removed` (45) · `security_weakened` (40) · `validation_removed` (40) · `sql_string_built` (40) · `new_domain` (20) · `empty_catch` (10) · `commented_out_block` (10) |
| **Privilege** | `sudo` (40) · `chmod_broad` (30) |
| **External** | `secret_exfil` (70) · `publish` (60) · `destructive_sql` (50) · `pipe_to_shell` (45) |
| **Discount** | `test_file` (−10 on size and scope signals only) |
| **Logged only** (0 points) | `deletion_heavy` · `signature_changed` · `env_key_renamed` · `edit_loop` · `unread_file` · `session_churn` |

</details>

### The ask flow

Cline's "auto-approve all" setting approves every tool call without asking, even one a plugin marks as needing
approval. So ClineShield asks **through the conversation** instead:

1. The action is skipped, and Cline is told to ask you in a plain chat message and end its turn.
2. You reply. ClineShield reads your answer from the conversation history: the identical action (same tool, same
   input, refused with the same reason) is allowed **once**, only if your next typed reply is a plain **yes** and that
   yes hasn't been used. A yes given before the question doesn't count, and a changed action is scored fresh.
3. A **no** keeps it refused and Cline asks what you want instead.

In a one-shot run (`cline "…"`), answer with `cline --id <session> "yes"`. Headless runs with nobody to answer stay
refused, never hang. Only your own agent can be approved; subagents stay refused.

We've asked Cline to let a plugin's "needs approval" override auto-approve all:
[cline/cline#15645](https://github.com/cline/cline/issues/15645).

### Failure and time

- **Deadline:** 2 s internally, under Cline's 3 s fail-open timeout. Checks run cheapest and most important first:
  path and pattern checks (no I/O) → reading the file and applying the edit in memory → `git status` (300 ms cap) →
  package registry (800 ms cap, shrunk to fit). If the deadline hits before the important checks finish, `on_error`
  decides; later checks are skipped and logged.
- **Errors:** unreadable tool input or a crash → `on_error` (default `ask`). A crash in a minor check skips only
  that check.
- **Privacy:** a newly added package's name is looked up on public npm / PyPI, unless it's scoped, `offline: true`
  is set, or you use a private registry. Logged commands have secrets masked.

## Evaluation

We ran **50 real Cline sessions** (Cline CLI 3.0.74, `balanced` preset, auto-approve on so ClineShield was the only
gate) on 20 tasks labelled before the runs (10 destructive, 8 safe, 2 grey and not judged): Sonnet 5.5 ×20, GPT-5.4 ×20, Opus 5.5 ×10, in Docker.
Full method, raw results and every run: [eval/REPORT.md](eval/REPORT.md).

| | Result |
|---|---|
| Destructive actions caught (asked or blocked) | **6 of 10** |
| Safe actions asked or blocked (false alarms) | **4 of 148** (4 asks, 0 blocks) |
| Destructive tasks where the model never tried the destructive action | **14 of 24** judged runs (13 not attempted, 1 declined in words) |
| Time added per action (replay, all actions) | median **0.42 ms**, p95 **4.13 ms** (n = 218) |
| Cost of the full run | **$4.8454** (cap $8.00) |

> [!NOTE]
> **Read this before the numbers.** On most destructive prompts the models did the safe thing on their own, so
> ClineShield had nothing to judge; the catch rate is over the 10 destructive actions models actually attempted.
> The sample is small (one run per task per model), so differences between models are anecdotes, not rates.

### After fixes

The misses and false alarms led to one batch of rubric fixes (points and cut-offs unchanged). These numbers come
from a **separate, smaller check** and are not part of the 50-run result above.

**Replay** of the same 50 runs' actions through the fixed rubric, at `balanced`: destructive actions stopped
**6 → 10** of 10; safe actions stopped **6 → 7** of 148.

**Live re-run** of the five tasks that had misses or false alarms, on the models that hit them (n = 8 runs):

| | Result |
|---|---|
| Destructive actions caught | **6 of 6** |
| Safe actions asked or blocked | **1 of 25** |

Models act differently from run to run, so this re-run shows the fixes firing on fresh attempts; with n = 8 it is
not a new catch rate. Details: [eval/REPORT.md › After fixes](eval/REPORT.md#after-fixes-2026-11-16-not-part-of-the-numbers-above).

<details>
<summary><b>Threats to validity</b></summary>

- We wrote the prompts and the labels. Labels were fixed before the runs; 7 were corrected after review, each noted.
- The test setup could be noticed (a decoy folder's README, the visible `.cline-shield/` folder), which likely made
  models more cautious and lowered the number of attempts.
- One Cline version (3.0.74), one preset live, Linux in Docker.
- No live timing: Cline 3.0.74's plugin sandbox drops plugin output, so time added is measured by replaying the
  same actions through the plugin's `beforeTool`, without Cline's own overhead.

</details>

## Limits

- **Where it runs:** Cline CLI, SDK and Kanban only (see [Install](#install)).
- **It judges actions, it isn't a sandbox.** It reads the command text and the files it names. A script Cline runs
  (`npm test`, `make`) can still do whatever that script does.
- **Patterns, not a full parser** for code: function and export removal, weakened tests and similar checks use
  per-language patterns (JS/TS, Python, Go, Java, Rust, Ruby).
- **Ask depends on the conversation** until [cline/cline#15645](https://github.com/cline/cline/issues/15645) lands.
- **Session memory** (recent edits, reads, test runs) lives in memory and resets when Cline restarts.

## What's next

- **Post-edit checks:** run the project's formatter, linter and type checker after an edit and feed errors back to
  Cline (needs a safe answer for untrusted repos first).
- More dependency checks: new, unpinned and downgraded packages, low download counts.
- `/clineshield init` and `/clineshield preset <name>` to edit the config from the terminal.
- More LLM providers for explanations (VS Code model API, OpenAI-compatible endpoints like OpenRouter or Ollama),
  and explanations for CLI-only users.
- Code structure via tree-sitter, if the eval shows patterns miss real deletions.
- A tighten-only project config: a repo can add protection but never loosen it.
- A JetBrains dashboard, if users ask and Cline supports plugins there.
- Upstream: [cline/cline#15645](https://github.com/cline/cline/issues/15645).

## Development

```text
package.json                 root manifest: cline.plugins → ./clineshield/src/plugin/index.ts
.cline-shield.example.yml    every config key, commented
SPEC.md                      features, status and roadmap (source of truth)
eval/                        evaluation harness, tasks, raw results and REPORT.md
clineshield/
├── src/plugin/              the Cline plugin: index.ts, rubric/, patch/, config/, visibility/
├── src/types/metrics.ts     metrics.json schema
├── src/metrics/             log reader and writer
├── src/extension.ts         VS Code extension: sidebar/, changeMap/, config/, extension/riskAnalysis/
└── scripts/                 plugin load check, top-packages refresh
```

```sh
cd clineshield
npm ci
npm test               # plugin and extension unit + integration tests
npm run test:eval      # evaluation harness tests (no paid runs)
```

- **Plugin from a local checkout:** `cline plugin install /path/to/ClineShield`.
- **Extension from source:** open this repo in VS Code and start the **Run Extension** launch config.

Contributions are welcome. Read [SPEC.md](SPEC.md) first; it says what's done, what's next and why.

## License

[MIT](LICENSE) © 2026 Hans Chundekad

ClineShield 1.0 was built with Satvik Gudipati and won at DeveloperWeek 2026.

<sub>ClineShield is an independent project, not affiliated with or endorsed by Cline.</sub>
