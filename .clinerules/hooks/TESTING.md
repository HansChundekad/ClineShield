# ClineShield Hook Testing

## Status: Phase 2 Complete ✅
- Direct patch parsing (no patch command needed)
- Detects added/deleted lines and functions
- Calculates structural change percentage
- Warnings for large changes (>50%) or deletions (>3 functions)
- Fast (<100ms) and reliable

---

## Implementation Approach

**Parses Cline's custom patch format directly:**
- No temp files needed
- No `patch` or `git apply` command
- Simple line-by-line parsing
- Pattern matching for function signatures

**Function Detection Patterns:**
- `function foo()` and `async function foo()`
- `methodName(): Type {` (TypeScript methods)
- `async methodName()` (async methods)
- `const foo = () => {}` and `const foo = async () => {}`

---

## Quick Test with Cline

**Setup:** Enable Cline hooks in VS Code settings

**Test 1 - Small edit:**
```
Ask Cline: "Add logging to validateEmail in user-service.ts"
Expected: Low change % (e.g., 20%), 0 functions deleted → ALLOWED
```

**Test 2 - Large change:**
```
Ask Cline: "Rewrite user-service.ts to be more concise"
Expected: ⚠️ WARNING: Large structural change (100%)
Expected: ⚠️ WARNING: Multiple functions deleted (8)
```

**Test 3 - Non-JS file:**
```
Create a test.json file, then ask Cline: "Edit test.json"
Expected: "Skipping analysis (not a TS/JS file)"
```

---

## Manual Tests

**Test 1: Basic function addition**
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
cat /tmp/test1.json | .clinerules/hooks/PreToolUse 2>&1 | grep "ANALYSIS RESULTS" -A 5
```
**Expected:** 1 added function detected

**Test 2: Function deletion with warning**
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
cat /tmp/test2.json | .clinerules/hooks/PreToolUse 2>&1 | grep "WARNING"
```
**Expected:** ⚠️ WARNING: Multiple functions deleted (4)

**Test 3: Large structural change**
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
cat /tmp/test3.json | .clinerules/hooks/PreToolUse 2>&1 | grep "Structural change"
```
**Expected:** Structural change: ~88% (8/9 lines)

---

## Performance

- **Target:** <2 seconds (per CLAUDE.md requirement)
- **Actual:** <100ms (pure bash parsing, no external tools)
- **Memory:** Minimal (no temp files, streams data)
