# ClineShield

A Cline plugin that checks every action Cline takes (file edits, deletes, shell commands) **before** it runs,
scores its risk, and answers **allow**, **ask** or **block**. Everything is logged to `.cline-shield/metrics.json`.
An optional VS Code extension shows the log as a live dashboard.

Status, roadmap and the full rubric live in [SPEC.md](SPEC.md). A full README comes last (SPEC "README").

## Install

```sh
cline plugin install https://github.com/HansChundekad/ClineShield
```

Works with zero config. Runs in the Cline CLI, SDK and Kanban (`/clineshield` needs CLI 3.0.74 or newer).

## How it decides

- **Allow:** the action runs.
- **Ask:** Cline is told to ask you in chat. Reply yes and the identical action runs once. In a one-shot run,
  answer with `cline --id <session>`. Headless runs with no user stay refused.
- **Block:** the action is skipped and Cline is told why, so it can try a smaller or safer change.

Type `/clineshield` in Cline for this session's counts, or `/clineshield why` for the last ask or block in full.
That output stays in your terminal and never enters the conversation.

## Configuration

The only config file is `~/.cline-shield.yml`; a `.cline-shield.yml` inside a repo is never read, so a cloned repo
can't change your settings. Changes apply on the next Cline action. Every key is optional; see
[.cline-shield.example.yml](.cline-shield.example.yml) for all of them.

- **preset:** `relaxed`, `balanced` (default) or `strict`. How readily ClineShield asks and blocks
  (ask/block cut-offs 60/90, 40/70, 25/50).
- **mode:** `enforce` (default): asks and blocks apply. `observe`: only logs what it would have done; hard rules
  (self-protection, placeholder rewrites, secrets added) still block.
- **on_error:** `ask` (default) or `allow`. What happens if ClineShield itself fails; `allow` lets the action run
  unchecked.
- Also: `offline`, `cutoffs`, `categories`, `protected_paths`, `trusted_commands`, `trusted_domains`, per-folder
  `paths`, and `custom_rules`.

## VS Code extension (optional)

Open the ClineShield view in the activity bar:

- **Waiting on you:** asks you haven't answered and the latest block, with every category, its points, the total
  and the cut-off. Dismiss with ×. The status bar shows how many are waiting.
- **Totals** and **Recent activity** (last 15 actions); click an action to see its categories.
- **Settings:** your preset, mode and config file, with Open config / Create config.
- **Change map:** every file Cline touched, coloured by its worst risk; files with a blocked attempt are marked.

**Explanations (opt-in):** run **ClineShield: Set Gemini API Key** and click **Explain** on an action to get a
plain-English explanation from Gemini 2.5 Flash. Nothing is sent until you click. The key is kept in VS Code's
secret storage (never in a file), and secrets are stripped from code before it is sent. **ClineShield: Clear
Gemini API Key** turns it off. A `gemini_api_key` in the YAML is ignored.

To run the extension from source, open this repo in VS Code and start the **Run Extension** launch config.
