# ClineShield Hook Testing Guide

This workspace is opened by the Extension Development Host for testing ClineShield hooks.

## Test Files

### `simple.ts` - Low Structural Change Testing
**Purpose:** Test edits with <20% structural change (should be allowed)

**Test Scenarios:**
1. **Small edits (should pass):**
   - Change function implementation (keep signature)
   - Update string literals
   - Add comments
   - Modify return values

2. **Example Cline prompts:**
   ```
   "Change the greet function to say 'Hi' instead of 'Hello'"
   "Update VERSION constant to 1.0.1"
   "Add JSDoc comments to the add function"
   ```

### `complex.ts` - High Structural Change Testing
**Purpose:** Test edits with >47% structural change + function/export deletions

**Test Scenarios:**
1. **Large refactors (should be blocked):**
   - Delete entire UserService class
   - Remove multiple exported functions
   - Restructure with >47% AST changes

2. **Function deletion (should be blocked):**
   - Delete `validateEmail` function
   - Remove `formatUserName` export

3. **Example Cline prompts:**
   ```
   "Delete the findUser and removeUser methods"
   "Completely rewrite the UserService class"
   "Remove the validateEmail function"
   ```

### `protected.ts` - Protected Files Testing
**Purpose:** Test protected file blocking (Phase 3 feature, hardcode in Phase 1)

**Test Scenarios:**
1. **Any edit should be blocked:**
   - Hooks should detect filename and cancel with error message

2. **Example Cline prompts:**
   ```
   "Update the apiKey in protected.ts"
   "Add a new function to protected.ts"
   ```

## How to Test

### 1. Launch Extension Development Host
1. Press `F5` in VS Code (main window)
2. New window opens with `test-workspace` loaded
3. ClineShield extension is active in the new window

### 2. Verify Extension is Running
- Check status bar for 🛡️ icon (bottom-right)
- Hover to see session ID and event count
- Open Output panel → "Extension Host" → Look for "ClineShield extension is now active"

### 3. Test with Cline
1. Open Cline in the Extension Development Host window
2. Use test prompts above
3. Watch for hook responses (approval/blocking)
4. Check `.cline-shield/metrics.json` for events

### 4. Verify Hook Behavior

**Expected metrics.json events:**
```json
// Small edit to simple.ts
{
  "timestamp": "2026-02-15T...",
  "sessionId": "...",
  "type": "edit-allowed",
  "data": {
    "file": "simple.ts",
    "structuralChangePercent": 15,
    "functionsDeleted": 0,
    "exportsDeleted": 0
  }
}

// Large edit to complex.ts
{
  "timestamp": "2026-02-15T...",
  "sessionId": "...",
  "type": "edit-blocked",
  "data": {
    "file": "complex.ts",
    "structuralChangePercent": 52,
    "functionsDeleted": 2,
    "exportsDeleted": 1,
    "reason": "Structural change exceeds 47% threshold"
  }
}
```

## Hook Validation Checklist

After implementing hooks in Phase 1-2, verify:

- [ ] Hook executes in <2s
- [ ] Hook exits with code 0 (always)
- [ ] Small edits to `simple.ts` → `edit-allowed` event
- [ ] Large refactor to `complex.ts` → `edit-blocked` event with error
- [ ] Function deletion → `edit-blocked` with specific error message
- [ ] Any edit to `protected.ts` → `edit-blocked`
- [ ] metrics.json updates atomically (temp file + rename)
- [ ] Status bar shows updated event count immediately
- [ ] File watcher detects new events within 100ms

## Expected Hook Responses

**Pre-Tool-Use Hook (`edit` tool):**
```json
// Allow
{"cancel": false}

// Block
{
  "cancel": true,
  "errorMessage": "ClineShield: 52% structural change. Make smaller edits."
}
```

**Post-Tool-Use Hook (all tools):**
```json
// Success - no modification needed
{}

// Provide guidance
{
  "contextModification": "CLINESHIELD: Syntax errors detected:\n- Line 23: Missing semicolon"
}
```

## Reset Test Files

To restore files to original state:
```bash
cd /Users/hanschundekad/ClineShield
git checkout test-workspace/*.ts
```

## Debugging Tips

1. **Hook not triggering:** Check Cline's settings → Hooks are enabled
2. **No metrics events:** Check `.cline-shield/` exists in test-workspace
3. **File watcher not updating:** Restart Extension Development Host (Cmd+R)
4. **Hook timeout:** Hooks must complete in <2s, check stderr logs
