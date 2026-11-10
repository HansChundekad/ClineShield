# CLAUDE.md

**ClineShield** - VS Code extension adding safety guardrails to Cline AI through hooks and quality checks.

**SPEC.md is the source of truth** for features, status and roadmap. Read the relevant section before starting work, and tick its checkboxes in the same commit once a feature is implemented and tested. If the spec turns out to be wrong, fix it in that commit. PROGRESS.md is the frozen 1.x build log — do not update it.

metrics.json:
- Format: JSON array (NOT JSONL)
- Location: {workspace}/.cline-shield/metrics.json
- Types: src/types/metrics.ts (source of truth)
- Writer: src/metrics/writer.ts (use appendEvent())
- Reader: src/metrics/reader.ts (use readEvents())

When implementing ANY feature touching metrics.json:
1. Read src/types/metrics.ts first
2. Use existing appendEvent() function
3. Never propose alternative schemas or formats

sessionId:
- Plugin: `ctx.session.sessionId` from Cline (fallback UUID); written on every event
- Extension: its own UUID per activation, kept in memory only (no env var); dashboards follow sessions per Decision 7

## Development Philosophy

### KISS + YAGNI + Sequential Phases
- Simple solutions first (bash script + Node.js, not microservices)
- Build only what's needed (no feature flags until Phase 3)
- **DO NOT skip phases** - each validates assumptions for the next
- Prove, then scale (Phase 0 logs stdin before building AST analyzer)

## Critical Rules

### Plugin Hooks
- **< 2 s internal deadline** - Cline times plugin hooks out after 3 s and then fails open
- **Never throw** - every hook error is caught and logged; a crash must not end the run
- **stderr for logs** - never print to stdout from the plugin
- **Atomic writes** - Temp file + rename for shared state

### The Shared Contract: metrics.json
**ALL features communicate through this file. SCHEMA IS FIXED. Never change the shape of metrics.json events.**


### Plugin Results
```ts
// beforeTool - block (Cline sees the reason and keeps working)
{ skip: true, reason: "ClineShield blocked this action: ..." }

// beforeTool - ask (Cline asks the user in chat; the identical action is allowed once after a plain yes)
{ skip: true, reason: "ClineShield: this edit needs the user's approval. ..." }
```

## File Organization

```
package.json                      // root manifest: cline.plugins -> ./clineshield/src/plugin/index.ts
clineshield/
├── scripts/                      // check-plugin-load.ts, refresh-top-packages.js, benchmark-atomic-writes.js
└── src/
    ├── plugin/                   // the Cline plugin: index.ts, rubric/, patch/, config/, visibility/, sidecar.ts
    ├── types/metrics.ts          // metrics.json schema (source of truth)
    ├── metrics/                  // reader, writer (appendEvent), sessions, metricsRoot, testEvents
    ├── extension.ts              // VS Code extension: activation, status bar, commands, config watcher
    ├── config/                   // configView.ts (read-only config line), setup.ts (plugin check, Create config)
    ├── sidebar/                  // dashboard.ts (pure model), MetricsSidebarProvider.ts, metrics.html
    ├── changeMap/                // aggregate.ts (pure), ChangeMapProvider.ts
    ├── extension/riskAnalysis/   // explain.ts, llmAnalyzer.ts (Gemini, on click)
    └── hooks/clineshield-analyze.js  // standalone 1.x AST prototype, unused
```

## Testing Requirements

Write tests before implementation (TDD). Focus on:
- **Unit**: Test functions in isolation (80%+ coverage target)
- **Integration**: Test plugin hooks against a temp workspace, metrics.json updates
- **E2E**: Real Cline sessions in a disposable git repo (manual)

## Phase-Specific Focus

### Phase 0: Foundation
**What Claude should focus on**:
1. Creating minimal hook scripts that **just log stdin**
2. Verifying Cline's actual hook inputs (don't assume docs are complete)
3. Building metrics.json read/write utilities with **validation**
4. Extension scaffold with **file watcher only** (no UI yet)

**What Claude should NOT do**:
- Build AST analyzer before verifying hook inputs
- Create UI components before data flow works
- Write config parser before hooks are stable

### Phase 1-2: Hooks Working
**What Claude should focus on**:
1. **Hardcode everything** (thresholds, tool paths, protected files)
2. Make hooks **fast** (<2s)
3. Test with **real Cline edits** (create test files, trigger Cline)
4. Verify metrics.json **actually updates**

**What Claude should NOT do**:
- Add YAML config (that's Phase 3)
- Build UI (that's Phase 4+)
- Optimize prematurely (get it working first)

### Phase 3+: Making It Real
**What Claude should focus on**:
1. **Validate YAML schema** (prevent injection attacks)
2. **Template substitution security** (escape user input)
3. **Error handling** (graceful degradation)
4. **User feedback** (clear error messages)

## Common Pitfalls

- **Check LLM availability** - Extension must work without LLM (no Gemini API key configured)
- **Use async file operations** - Extension host must not block
- **Atomic writes for shared state** - Use temp file + rename pattern

## Security Checklist

- Validate YAML input (use allowlist for config values)
- Validate file paths (prevent `../../etc/passwd` injection)
- Sanitize diffs before LLM (remove secrets)
- Timeout hooks after 30s
- Use `child_process.spawn` with explicit args (not shell)

## When to Ask for Help

**Stop immediately if**:
- Cline's hook API doesn't match documentation
- metrics.json schema needs to change (breaks other features)
- Performance target missed (<2s hooks, <100ms UI)
- Security concern (file access, LLM input, YAML parsing)

## Git Workflow

**Branch naming**: `phase-X/feature-name` (e.g., `phase-0/foundation`, `fix/metrics-race`)

**Commit format**: 
```
<type>(<scope>): <subject>

- Detail 1
- Detail 2

Closes #X
```

**Types**: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

**Never include**: "claude code", "written by claude", "AI-generated"

---

**Remember**: Build one phase at a time. Test hooks independently. Simple beats clever.
