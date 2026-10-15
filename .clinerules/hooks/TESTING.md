# ClineShield Hook Testing (1.x hook files)

> These are the 1.x bash hooks. They are being replaced by the 2.0 Cline plugin — see `SPEC.md`.
> The canonical copies live in `clineshield/hooks/`; the copies in this folder may lag behind.

## What PreToolUse does
- Parses Cline's `apply_patch` format directly (no `patch` / `git apply`)
- Counts added/deleted lines and deleted functions in TS/JS files
- Calculates structural change % (changed lines ÷ patch lines)
- **Blocks** (`{"cancel": true, "errorMessage": …}`) when more than 3 functions are deleted, or the patch is
  more than 10 lines with more than 75% change (thresholds configurable via `.cline-shield.yml`)
- Writes `edit-blocked` / `edit-allowed` to `.cline-shield/metrics.json` in the current directory
- Requires `jq`; without it the hook allows everything and logs a warning

**Function detection** (regex): `function foo(`, `export [async] function foo`, `const foo = … =>`.
Class methods are not detected.

---

## Manual Tests

Run these from a scratch directory — the hook writes `.cline-shield/metrics.json` into the current directory.
Use `cat <<'EOF'` (not `echo`) so `\n` escapes stay inside the JSON.

**Test 1: Function addition → allowed**
```bash
cat > /tmp/test1.json << 'EOF'
{
  "preToolUse": {
    "toolName": "apply_patch",
    "parameters": {
      "input": "*** Begin Patch\n*** Update File: test.ts\n@@\n context();\n+\n+ function newFunc() {\n+   return 42;\n+ }\n*** End Patch"
    }
  }
}
EOF
cat /tmp/test1.json | path/to/PreToolUse 2>/dev/null
```
**Expected:** `{"cancel":false}`

**Test 2: Four function deletions → blocked**
```bash
cat > /tmp/test2.json << 'EOF'
{
  "preToolUse": {
    "toolName": "apply_patch",
    "parameters": {
      "input": "*** Begin Patch\n*** Update File: test.ts\n@@\n- function a() {}\n- function b() {}\n- function c() {}\n- function d() {}\n*** End Patch"
    }
  }
}
EOF
cat /tmp/test2.json | path/to/PreToolUse 2>/dev/null
```
**Expected:** `{"cancel":true,"errorMessage":"⛔ ClineShield: 4 functions deleted, 100% structural change. …"}`

**Test 3: Structural change calculation**
```bash
cat > /tmp/test3.json << 'EOF'
{
  "preToolUse": {
    "toolName": "apply_patch",
    "parameters": {
      "input": "*** Begin Patch\n*** Update File: test.ts\n@@\n- old line 1\n- old line 2\n- old line 3\n+ new line 1\n+ new line 2\n+ new line 3\n+ new line 4\n+ new line 5\n context\n*** End Patch"
    }
  }
}
EOF
cat /tmp/test3.json | path/to/PreToolUse 2>&1 >/dev/null | grep "Structural change"
```
**Expected:** `Structural change: 88% (8/9 lines)` — allowed, because the patch is not over 10 lines.

---

## Performance
- **Target:** < 2 seconds
- **Measured:** ~80 ms per call for a blocked `apply_patch` (macOS, 2026-10-14)
