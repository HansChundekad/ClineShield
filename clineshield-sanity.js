// ClineShield Sanity Checker - Phase 2
//
// Runs after each file edit to perform quick quality checks:
// - ESLint
// - TypeScript (tsc)
// - Prettier
//
// Writes retry state and metrics events to .cline-shield/, and emits
// human-readable context on stdout for Cline to consume.

/* eslint-disable no-console */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = process.cwd();
const SHIELD_DIR = path.join(WORKSPACE_ROOT, '.cline-shield');
const RETRY_STATE_PATH = path.join(SHIELD_DIR, 'retry-state.json');
const METRICS_PATH = path.join(SHIELD_DIR, 'metrics.json');
const CONTEXT_FILE = path.join(SHIELD_DIR, 'context-injection.txt');

const DEFAULT_MAX_RETRIES = 3;

function ensureShieldDir() {
  if (!fs.existsSync(SHIELD_DIR)) {
    fs.mkdirSync(SHIELD_DIR, { recursive: true });
  }
}

function readJsonFileSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error('[ClineShield] Failed to read JSON file', filePath, error);
    return fallback;
  }
}

function writeJsonFileAtomic(filePath, data) {
  try {
    ensureShieldDir();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    console.error('[ClineShield] Failed to write JSON file', filePath, error);
  }
}

// ---------------------------------------------------------------------------
// Retry state (per-file)
// ---------------------------------------------------------------------------

function loadRetryEntry(filePath) {
  const allState = readJsonFileSafe(RETRY_STATE_PATH, {});
  if (typeof allState !== 'object' || Array.isArray(allState) || allState === null) {
    return { retries: 0, maxRetries: DEFAULT_MAX_RETRIES };
  }

  const entry = allState[filePath] || {};
  return {
    retries: typeof entry.retries === 'number' ? entry.retries : 0,
    maxRetries:
      typeof entry.maxRetries === 'number' ? entry.maxRetries : DEFAULT_MAX_RETRIES,
    lastError: typeof entry.lastError === 'string' ? entry.lastError : '',
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
  };
}

function saveRetryEntry(filePath, entry) {
  const allState = readJsonFileSafe(RETRY_STATE_PATH, {});
  const nextState =
    typeof allState === 'object' && !Array.isArray(allState) && allState !== null
      ? allState
      : {};

  if (entry.retries === 0 && !entry.lastError) {
    // Clean up entry on full success
    delete nextState[filePath];
  } else {
    nextState[filePath] = {
      retries: entry.retries,
      maxRetries: entry.maxRetries,
      lastError: entry.lastError || '',
      timestamp: entry.timestamp || new Date().toISOString(),
    };
  }

  writeJsonFileAtomic(RETRY_STATE_PATH, nextState);
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

function appendMetricsEvent(event) {
  ensureShieldDir();

  let events = readJsonFileSafe(METRICS_PATH, []);
  if (!Array.isArray(events)) {
    console.error(
      '[ClineShield] metrics.json is not an array, resetting to empty from sanity hook',
    );
    events = [];
  }

  events.push(event);
  writeJsonFileAtomic(METRICS_PATH, events);
}

function buildBaseEvent(type) {
  return {
    timestamp: new Date().toISOString(),
    sessionId: process.env.CLINESHIELD_SESSION_ID || 'unknown-session',
    type,
  };
}

// ---------------------------------------------------------------------------
// Sanity checks
// ---------------------------------------------------------------------------

function runSanityChecks(filePath) {
  const results = {
    eslint: { passed: true, errors: [] },
    typescript: { passed: true, errors: [] },
    prettier: { passed: true, errors: [] },
  };

  // ESLint check
  try {
    execSync(`npx eslint "${filePath}" --format json`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    results.eslint.passed = true;
  } catch (error) {
    results.eslint.passed = false;
    try {
      const outputJson = JSON.parse(error.stdout || '[]');
      const messages = outputJson[0]?.messages || [];
      results.eslint.errors = messages.map(
        (m) => `L${m.line}:${m.column} ${m.message} (${m.ruleId || 'no-rule'})`,
      );
    } catch (parseError) {
      const fallback =
        (error.stdout || error.stderr || '').toString().split('\n').filter(Boolean);
      results.eslint.errors = fallback.length
        ? fallback
        : ['ESLint failed with unknown error'];
    }
  }

  // TypeScript check (if .ts/.tsx file)
  if (filePath.match(/\.tsx?$/)) {
    try {
      execSync(`npx tsc --noEmit "${filePath}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      results.typescript.passed = true;
    } catch (error) {
      results.typescript.passed = false;
      const output = (error.stdout || error.stderr || '').toString();
      results.typescript.errors = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    }
  }

  // Prettier check
  try {
    execSync(`npx prettier --check "${filePath}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    results.prettier.passed = true;
  } catch (error) {
    results.prettier.passed = false;
    results.prettier.errors = ['Code formatting issues detected by Prettier'];
  }

  return results;
}

function generateErrorSummary(results) {
  const errors = [];

  if (!results.eslint.passed) {
    const count = results.eslint.errors.length;
    errors.push(`${count} ESLint error(s)`);
  }

  if (!results.typescript.passed) {
    errors.push('TypeScript compilation errors');
  }

  if (!results.prettier.passed) {
    errors.push('Prettier formatting issues');
  }

  return errors.join(', ');
}

function formatErrorDetails(results) {
  const lines = [];

  if (!results.eslint.passed && results.eslint.errors.length) {
    lines.push('ESLint:');
    results.eslint.errors.slice(0, 10).forEach((e) => lines.push(`  - ${e}`));
    if (results.eslint.errors.length > 10) {
      lines.push(`  - ... ${results.eslint.errors.length - 10} more`);
    }
  }

  if (!results.typescript.passed && results.typescript.errors.length) {
    lines.push('');
    lines.push('TypeScript:');
    results.typescript.errors.slice(0, 10).forEach((e) => lines.push(`  - ${e}`));
    if (results.typescript.errors.length > 10) {
      lines.push(`  - ... ${results.typescript.errors.length - 10} more`);
    }
  }

  if (!results.prettier.passed && results.prettier.errors.length) {
    lines.push('');
    lines.push('Prettier:');
    results.prettier.errors.forEach((e) => lines.push(`  - ${e}`));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: clineshield-sanity.js <file-path>');
    process.exit(1);
  }

  ensureShieldDir();

  const retryEntry = loadRetryEntry(filePath);
  const startTime = Date.now();

  const results = runSanityChecks(filePath);
  const allPassed = Object.values(results).every((r) => r.passed);
  const durationSeconds = (Date.now() - startTime) / 1000;

  // Metrics: sanity-passed / sanity-failed events
  if (allPassed) {
    const passedTools = Object.entries(results)
      .filter(([, r]) => r.passed)
      .map(([name]) => name);

    appendMetricsEvent({
      ...buildBaseEvent('sanity-passed'),
      data: {
        file: filePath,
        tools: passedTools,
        duration: durationSeconds,
      },
    });

    // Reset retry state on success
    saveRetryEntry(filePath, {
      retries: 0,
      maxRetries: retryEntry.maxRetries || DEFAULT_MAX_RETRIES,
      lastError: '',
      timestamp: new Date().toISOString(),
    });

    // Clear any previous context injection
    try {
      if (fs.existsSync(CONTEXT_FILE)) {
        fs.unlinkSync(CONTEXT_FILE);
      }
    } catch {
      // Ignore
    }

    process.exit(0);
  }

  // One or more checks failed
  const newRetryCount = Math.min(
    (retryEntry.retries || 0) + 1,
    retryEntry.maxRetries || DEFAULT_MAX_RETRIES,
  );

  const failedTools = Object.entries(results).filter(([, r]) => !r.passed);
  failedTools.forEach(([toolName, result]) => {
    appendMetricsEvent({
      ...buildBaseEvent('sanity-failed'),
      data: {
        file: filePath,
        tool: toolName,
        errors: Array.isArray(result.errors) ? result.errors : [],
        retryCount: newRetryCount,
        maxRetries: retryEntry.maxRetries || DEFAULT_MAX_RETRIES,
      },
    });
  });

  const summary = generateErrorSummary(results);
  const details = formatErrorDetails(results);

  const retriesRemaining =
    (retryEntry.maxRetries || DEFAULT_MAX_RETRIES) - newRetryCount;

  let message;
  let exitCode;

  if (newRetryCount < (retryEntry.maxRetries || DEFAULT_MAX_RETRIES)) {
    // Retries still available
    message = [
      '⚠️ SANITY CHECK FAILED ⚠️',
      '',
      `File: ${filePath}`,
      '',
      `Issues found: ${summary || 'Unknown issues'}`,
      '',
      details,
      '',
      `Retry ${newRetryCount}/${
        retryEntry.maxRetries || DEFAULT_MAX_RETRIES
      } available.`,
      `You have ${retriesRemaining} retries remaining.`,
      'Please fix these issues and try again.',
    ].join('\n');

    exitCode = 1;
  } else {
    // Max retries exceeded
    message = [
      '⛔ SANITY CHECK MAX RETRIES EXCEEDED ⛔',
      '',
      `File: ${filePath}`,
      '',
      `Issues found: ${summary || 'Unknown issues'}`,
      '',
      details,
      '',
      `Max retries (${retryEntry.maxRetries || DEFAULT_MAX_RETRIES}) reached.`,
      'Cline will stop automatic retries. Please fix these issues manually.',
    ].join('\n');

    exitCode = 2;
  }

  // Persist updated retry entry
  saveRetryEntry(filePath, {
    retries: newRetryCount,
    maxRetries: retryEntry.maxRetries || DEFAULT_MAX_RETRIES,
    lastError: summary,
    timestamp: new Date().toISOString(),
  });

  // Context injection for Cline (Option A: stdout, Option B: shared file)
  try {
    fs.writeFileSync(CONTEXT_FILE, message, 'utf8');
  } catch (error) {
    console.error('[ClineShield] Failed to write context injection file:', error);
  }

  console.log(message);
  process.exit(exitCode);
}

main();


