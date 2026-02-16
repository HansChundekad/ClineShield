# ClineShield Hook Testing

## Status: Phase 2 Complete ✅
- AST analysis integrated
- Logs structural change %, deleted functions/exports
- Warnings for large changes (>50%) or deletions (>3)

---

## Quick Test with Cline

**Setup:** Enable Cline hooks in VS Code settings

**Test 1 - Small edit:**
```
Ask Cline: "Add a new function to sandbox/test-files/sample.ts"
Expected: Analysis runs, low change %
```

**Test 2 - Large change:**
```
Ask Cline: "Delete 5 functions from sandbox/test-files/sample.ts"
Expected: ⚠️ warnings appear
```

**Test 3 - Non-JS file:**
```
Ask Cline: "Edit sandbox/test-files/data.json"
Expected: "Skipping analysis (not a TS/JS file)"
```

---

## Manual Test

```bash
echo '{"preToolUse":{"tool":"edit_file","parameters":{"file_path":"test.ts","old_string":"export function f1() {}\nexport function f2() {}","new_string":"export function f1() {}"}}}' | .clinerules/hooks/PreToolUse
```

**Expected:** Analysis results with 1 deleted function
