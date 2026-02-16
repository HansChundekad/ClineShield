# ClineShield Hook Testing Guide

## Phase 1: Detection & Logging

### Hook Status
✅ **PreToolUse** - Enhanced for Phase 1
- Detects `edit_file` operations
- Detects `write_to_file` operations
- Logs file paths and content sizes
- Blocks dangerous commands
- Ready for Phase 2 AST integration

---

## Manual Testing

### Test 1: Edit File Detection
```bash
echo '{"preToolUse":{"tool":"edit_file","parameters":{"file_path":"test.ts","old_string":"old","new_string":"new"}}}' | .clinerules/hooks/PreToolUse
```

**Expected Output:**
- stdout: `{"cancel":false}`
- stderr: Logs showing file path, content sizes, "Phase 1: Logging only"

### Test 2: Write File Detection
```bash
echo '{"preToolUse":{"tool":"write_to_file","parameters":{"file_path":"new.ts","content":"code"}}}' | .clinerules/hooks/PreToolUse
```

**Expected Output:**
- stdout: `{"cancel":false}`
- stderr: Logs showing file path, content size

### Test 3: Dangerous Command Blocking
```bash
echo '{"preToolUse":{"tool":"execute_command","parameters":{"command":"rm -rf /"}}}' | .clinerules/hooks/PreToolUse
```

**Expected Output:**
- stdout: `{"cancel":true,"errorMessage":"⛔ ClineShield: Dangerous command blocked"}`
- stderr: "BLOCKED: Dangerous command detected"

---

## Testing with Real Cline

1. Make sure Cline's hooks are enabled in settings
2. Edit a TypeScript file in your project
3. Check Cline's output/logs for `[ClineShield]` messages
4. Verify hook is called before edits

**What to look for:**
```
[ClineShield] Tool: edit_file
[ClineShield] === EDIT_FILE DETECTED ===
[ClineShield] File: /path/to/file.ts
[ClineShield] Old content size: X chars
[ClineShield] New content size: Y chars
[ClineShield] Phase 1: Logging only (analysis in Phase 2)
```

---

## Phase 2 Preparation Checklist

Before starting Phase 2, verify:
- [ ] Hook receives correct `old_string` and `new_string` from Cline
- [ ] File paths are absolute paths
- [ ] Content is complete (not truncated)
- [ ] Hook executes in <500ms (well under 2s limit)
- [ ] `jq` is available on system

---

## Troubleshooting

**Hook not being called:**
- Check Cline settings: hooks must be enabled
- Verify hook is executable: `chmod +x .clinerules/hooks/PreToolUse`
- Check Cline logs for hook errors

**jq not found:**
- Install: `brew install jq` (macOS) or `apt install jq` (Linux)
- Hook will disable itself gracefully if jq missing

**Hook too slow:**
- Phase 1 should be <100ms
- If slow, check system load or disk I/O
