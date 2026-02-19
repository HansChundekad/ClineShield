/**
 * rulesEngine.ts
 *
 * Rules-based risk scoring engine for ClineShield.
 * Scores edits 0-100 (additive, capped) based on file path, structural change,
 * function deletions, sanity check outcome, and diff size.
 *
 * Output shape matches the RiskAssessedEvent.data schema in types/metrics.ts.
 */

export interface RiskInput {
  filePath: string;
  structuralChangePercent: number;
  deletedFunctions: number;
  sanityPassed: boolean;
  diffLineCount: number;
}

export interface RiskReason {
  rule: string;        // e.g. 'protected_path'
  points: number;      // Contribution to score (negative for deductions)
  description: string; // Human-readable explanation
}

export interface RiskResult {
  score: number;                     // 0-100, capped
  level: 'low' | 'medium' | 'high'; // low: 0-30, medium: 31-60, high: 61-100
  reasons: RiskReason[];
}

// ── Protected path config (hardcoded for Phase 5; YAML-configurable in Phase 3) ──

const PROTECTED_PATH_PREFIXES = [
  'src/config/',
  'src/auth/',
  'src/middleware/',
  'auth/',
  'config/',
];

// Exact basename matches — trailing-slash entries above cover directories,
// these cover individual files. Aligns with bash hook behaviour.
const PROTECTED_FILE_EXACT = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? normalized;

  if (PROTECTED_FILE_EXACT.includes(basename)) {
    return true;
  }
  // Prefix match from path root only — consistent with bash `[[ path == prefix* ]]`
  return PROTECTED_PATH_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath);
}

function levelFromScore(score: number): 'low' | 'medium' | 'high' {
  if (score <= 30) { return 'low'; }
  if (score <= 60) { return 'medium'; }
  return 'high';
}

// ── Scoring engine ────────────────────────────────────────────────────────────

export function computeRiskScore(input: RiskInput): RiskResult {
  const reasons: RiskReason[] = [];
  let score = 0;

  // Rule 1: File is in a protected path (+30)
  if (isProtectedPath(input.filePath)) {
    score += 30;
    reasons.push({
      rule: 'protected_path',
      points: 30,
      description: `File is in a protected path (${input.filePath})`,
    });
  }

  // Rule 2/3: Structural change — tiered, not additive
  // >75%: +40  |  >50%: +25  |  ≤50%: +0
  if (input.structuralChangePercent > 75) {
    score += 40;
    reasons.push({
      rule: 'structural_change_high',
      points: 40,
      description: `Structural change is ${input.structuralChangePercent}% (exceeds 75%)`,
    });
  } else if (input.structuralChangePercent > 50) {
    score += 25;
    reasons.push({
      rule: 'structural_change_medium',
      points: 25,
      description: `Structural change is ${input.structuralChangePercent}% (exceeds 50%)`,
    });
  }

  // Rule 4/5: Deleted functions — tiered, not additive
  // >3: +35  |  >0: +20  |  0: +0
  if (input.deletedFunctions > 3) {
    score += 35;
    reasons.push({
      rule: 'deleted_functions_high',
      points: 35,
      description: `${input.deletedFunctions} functions deleted (exceeds 3)`,
    });
  } else if (input.deletedFunctions > 0) {
    score += 20;
    reasons.push({
      rule: 'deleted_functions_low',
      points: 20,
      description: `${input.deletedFunctions} function(s) deleted`,
    });
  }

  // Rule 6: Sanity check failed (+20)
  if (!input.sanityPassed) {
    score += 20;
    reasons.push({
      rule: 'sanity_failed',
      points: 20,
      description: 'Quality checks (eslint/tsc/prettier) failed after this edit',
    });
  }

  // Rule 7: Large diff (+15)
  if (input.diffLineCount > 200) {
    score += 15;
    reasons.push({
      rule: 'large_diff',
      points: 15,
      description: `Diff is ${input.diffLineCount} lines (exceeds 200)`,
    });
  }

  // Rule 8: Test file deduction (-10)
  if (isTestFile(input.filePath)) {
    score -= 10;
    reasons.push({
      rule: 'test_file',
      points: -10,
      description: 'Test file — lower inherent risk',
    });
  }

  const finalScore = Math.min(100, Math.max(0, score));

  return {
    score: finalScore,
    level: levelFromScore(finalScore),
    reasons,
  };
}
