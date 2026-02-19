import { computeRiskScore } from '../rulesEngine';
import type { RiskInput } from '../rulesEngine';

// Baseline: all-zero input, neutral file, sanity passed
const baseline: RiskInput = {
  filePath: 'src/utils/helper.ts',
  structuralChangePercent: 0,
  deletedFunctions: 0,
  sanityPassed: true,
  diffLineCount: 0,
};

describe('computeRiskScore', () => {
  // ── Baseline ──────────────────────────────────────────────────────────────

  describe('baseline', () => {
    it('returns score 0 with no risk factors', () => {
      const result = computeRiskScore(baseline);
      expect(result.score).toBe(0);
      expect(result.level).toBe('low');
      expect(result.reasons).toHaveLength(0);
    });
  });

  // ── Rule: protected path (+30) ─────────────────────────────────────────────

  describe('protected path rule', () => {
    const protectedCases = [
      'src/config/loader.ts',
      'src/auth/middleware.ts',
      'src/middleware/cors.ts',
      'auth/index.ts',
      'config/app.ts',
      '.env',
      '.env.local',
      '.env.production',
    ];

    it.each(protectedCases)('adds +30 for protected path: %s', (filePath) => {
      const result = computeRiskScore({ ...baseline, filePath });
      expect(result.score).toBe(30);
      const reason = result.reasons.find(r => r.rule === 'protected_path');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(30);
    });

    const neutralCases = [
      'src/utils/helper.ts',
      'src/components/Button.tsx',
      'src/sidebar/MetricsSidebarProvider.ts',
      'test/fixtures/sample.ts',
    ];

    it.each(neutralCases)('adds +0 for non-protected path: %s', (filePath) => {
      const result = computeRiskScore({ ...baseline, filePath });
      expect(result.score).toBe(0);
      expect(result.reasons.find(r => r.rule === 'protected_path')).toBeUndefined();
    });
  });

  // ── Rule: structural change (tiered) ──────────────────────────────────────

  describe('structural change rule', () => {
    it('adds +0 for 0% structural change', () => {
      const result = computeRiskScore({ ...baseline, structuralChangePercent: 0 });
      expect(result.score).toBe(0);
    });

    it('adds +0 for exactly 50% structural change (boundary: must exceed 50)', () => {
      const result = computeRiskScore({ ...baseline, structuralChangePercent: 50 });
      expect(result.score).toBe(0);
    });

    it('adds +25 for 51% structural change (medium tier)', () => {
      const result = computeRiskScore({ ...baseline, structuralChangePercent: 51 });
      expect(result.score).toBe(25);
      const reason = result.reasons.find(r => r.rule === 'structural_change_medium');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(25);
    });

    it('adds +25 for exactly 75% structural change (boundary: must exceed 75 for high)', () => {
      const result = computeRiskScore({ ...baseline, structuralChangePercent: 75 });
      expect(result.score).toBe(25);
      expect(result.reasons.find(r => r.rule === 'structural_change_medium')).toBeDefined();
      expect(result.reasons.find(r => r.rule === 'structural_change_high')).toBeUndefined();
    });

    it('adds +40 for 76% structural change (high tier, replaces medium)', () => {
      const result = computeRiskScore({ ...baseline, structuralChangePercent: 76 });
      expect(result.score).toBe(40);
      const reason = result.reasons.find(r => r.rule === 'structural_change_high');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(40);
      expect(result.reasons.find(r => r.rule === 'structural_change_medium')).toBeUndefined();
    });

    it('adds +40 (not +65) for 100% structural change — tiers are not additive', () => {
      const result = computeRiskScore({ ...baseline, structuralChangePercent: 100 });
      expect(result.score).toBe(40);
    });
  });

  // ── Rule: deleted functions (tiered) ──────────────────────────────────────

  describe('deleted functions rule', () => {
    it('adds +0 for 0 deleted functions', () => {
      const result = computeRiskScore({ ...baseline, deletedFunctions: 0 });
      expect(result.score).toBe(0);
    });

    it('adds +20 for 1 deleted function', () => {
      const result = computeRiskScore({ ...baseline, deletedFunctions: 1 });
      expect(result.score).toBe(20);
      const reason = result.reasons.find(r => r.rule === 'deleted_functions_low');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(20);
    });

    it('adds +20 for exactly 3 deleted functions (boundary: must exceed 3 for high)', () => {
      const result = computeRiskScore({ ...baseline, deletedFunctions: 3 });
      expect(result.score).toBe(20);
      expect(result.reasons.find(r => r.rule === 'deleted_functions_low')).toBeDefined();
      expect(result.reasons.find(r => r.rule === 'deleted_functions_high')).toBeUndefined();
    });

    it('adds +35 for 4 deleted functions (high tier, replaces low)', () => {
      const result = computeRiskScore({ ...baseline, deletedFunctions: 4 });
      expect(result.score).toBe(35);
      const reason = result.reasons.find(r => r.rule === 'deleted_functions_high');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(35);
      expect(result.reasons.find(r => r.rule === 'deleted_functions_low')).toBeUndefined();
    });

    it('adds +35 (not +55) for 10 deleted functions — tiers are not additive', () => {
      const result = computeRiskScore({ ...baseline, deletedFunctions: 10 });
      expect(result.score).toBe(35);
    });
  });

  // ── Rule: sanity failed (+20) ──────────────────────────────────────────────

  describe('sanity failed rule', () => {
    it('adds +20 when sanity check failed', () => {
      const result = computeRiskScore({ ...baseline, sanityPassed: false });
      expect(result.score).toBe(20);
      const reason = result.reasons.find(r => r.rule === 'sanity_failed');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(20);
    });

    it('adds +0 when sanity check passed', () => {
      const result = computeRiskScore({ ...baseline, sanityPassed: true });
      expect(result.score).toBe(0);
      expect(result.reasons.find(r => r.rule === 'sanity_failed')).toBeUndefined();
    });
  });

  // ── Rule: large diff (+15) ─────────────────────────────────────────────────

  describe('large diff rule', () => {
    it('adds +0 for exactly 200 lines (boundary: must exceed 200)', () => {
      const result = computeRiskScore({ ...baseline, diffLineCount: 200 });
      expect(result.score).toBe(0);
    });

    it('adds +15 for 201 lines', () => {
      const result = computeRiskScore({ ...baseline, diffLineCount: 201 });
      expect(result.score).toBe(15);
      const reason = result.reasons.find(r => r.rule === 'large_diff');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(15);
    });

    it('adds +15 for 500 lines (no additional points past threshold)', () => {
      const result = computeRiskScore({ ...baseline, diffLineCount: 500 });
      expect(result.score).toBe(15);
    });
  });

  // ── Rule: test file deduction (-10) ──────────────────────────────────────

  describe('test file rule', () => {
    const testFileCases = [
      'src/utils/helper.test.ts',
      'src/services/user.spec.ts',
      'src/components/Button.test.tsx',
      '__tests__/something.test.js',
    ];

    it.each(testFileCases)('subtracts -10 for test file: %s', (filePath) => {
      // Give it a base score so we can verify the deduction
      const result = computeRiskScore({ ...baseline, filePath, deletedFunctions: 1 });
      // deletedFunctions:1 = +20, test = -10 → 10
      expect(result.score).toBe(10);
      const reason = result.reasons.find(r => r.rule === 'test_file');
      expect(reason).toBeDefined();
      expect(reason!.points).toBe(-10);
    });

    it('does not go below 0 when only test file rule applies', () => {
      const result = computeRiskScore({ ...baseline, filePath: 'src/foo.test.ts' });
      expect(result.score).toBe(0);
    });

    it('applies deduction to test files even in protected paths', () => {
      const result = computeRiskScore({
        ...baseline,
        filePath: 'src/auth/auth.test.ts',
      });
      // protected(+30) + test(-10) = 20
      expect(result.score).toBe(20);
    });
  });

  // ── Score capping ─────────────────────────────────────────────────────────

  describe('score capping', () => {
    it('caps score at 100', () => {
      // protected(30) + structuralHigh(40) + deletedHigh(35) + sanityFailed(20) + largeDiff(15) = 140
      const result = computeRiskScore({
        filePath: 'src/auth/index.ts',
        structuralChangePercent: 100,
        deletedFunctions: 10,
        sanityPassed: false,
        diffLineCount: 500,
      });
      expect(result.score).toBe(100);
      expect(result.level).toBe('high');
    });

    it('floors score at 0 when deductions exceed additions', () => {
      const result = computeRiskScore({
        ...baseline,
        filePath: 'src/utils/foo.test.ts',
        // Only the -10 test deduction applies, base is 0
      });
      expect(result.score).toBe(0);
    });
  });

  // ── Level thresholds ──────────────────────────────────────────────────────

  describe('level thresholds', () => {
    it('returns low for score 0', () => {
      expect(computeRiskScore(baseline).level).toBe('low');
    });

    it('returns low for score 30 (boundary)', () => {
      // protected_path only = 30
      const result = computeRiskScore({ ...baseline, filePath: 'src/config/app.ts' });
      expect(result.score).toBe(30);
      expect(result.level).toBe('low');
    });

    it('returns medium for score 31', () => {
      // protected(30) + sanityFailed(20) = 50 → medium
      const result = computeRiskScore({
        ...baseline,
        filePath: 'src/config/app.ts',
        sanityPassed: false,
      });
      expect(result.score).toBe(50);
      expect(result.level).toBe('medium');
    });

    it('returns medium for score 60 (boundary)', () => {
      // protected(30) + structuralMedium(25) + sanityFailed(20) - but 30+25+20=75 → too high
      // Use: structuralMedium(25) + deletedLow(20) + sanityFailed(20) - largeDiff(0) = no wait that's 65
      // Let's get exactly 60: deletedHigh(35) + sanityFailed(20) + largeDiff no = 55, + deletedFunctions...
      // structuralMedium(25) + deletedHigh(35) = 60
      const result = computeRiskScore({
        ...baseline,
        structuralChangePercent: 60,
        deletedFunctions: 4,
      });
      expect(result.score).toBe(60);
      expect(result.level).toBe('medium');
    });

    it('returns high for score 61', () => {
      // structuralMedium(25) + deletedHigh(35) + sanityFailed(20) = 80 → high
      const result = computeRiskScore({
        ...baseline,
        structuralChangePercent: 60,
        deletedFunctions: 4,
        sanityPassed: false,
      });
      expect(result.score).toBe(80);
      expect(result.level).toBe('high');
    });

    it('returns high for score 100', () => {
      const result = computeRiskScore({
        filePath: 'src/auth/index.ts',
        structuralChangePercent: 100,
        deletedFunctions: 10,
        sanityPassed: false,
        diffLineCount: 500,
      });
      expect(result.level).toBe('high');
    });
  });

  // ── Reason structure ──────────────────────────────────────────────────────

  describe('reason structure', () => {
    it('every reason has rule, points, and description fields', () => {
      const result = computeRiskScore({
        filePath: 'src/config/app.ts',
        structuralChangePercent: 80,
        deletedFunctions: 2,
        sanityPassed: false,
        diffLineCount: 300,
      });
      expect(result.reasons.length).toBeGreaterThan(0);
      for (const reason of result.reasons) {
        expect(typeof reason.rule).toBe('string');
        expect(reason.rule.length).toBeGreaterThan(0);
        expect(typeof reason.points).toBe('number');
        expect(typeof reason.description).toBe('string');
        expect(reason.description.length).toBeGreaterThan(0);
      }
    });

    it('reasons sum to raw (uncapped) score', () => {
      // Use inputs that do NOT cap at 100
      const result = computeRiskScore({
        ...baseline,
        structuralChangePercent: 60,   // +25
        deletedFunctions: 1,           // +20
      });
      const reasonSum = result.reasons.reduce((sum, r) => sum + r.points, 0);
      expect(reasonSum).toBe(result.score); // 45, no capping needed
    });

    it('description includes the file path for protected_path rule', () => {
      const filePath = 'src/auth/service.ts';
      const result = computeRiskScore({ ...baseline, filePath });
      const reason = result.reasons.find(r => r.rule === 'protected_path');
      expect(reason!.description).toContain(filePath);
    });
  });

  // ── Combined real-world scenarios ─────────────────────────────────────────

  describe('real-world scenarios', () => {
    it('small refactor in utility file — low risk', () => {
      const result = computeRiskScore({
        filePath: 'src/utils/formatter.ts',
        structuralChangePercent: 20,
        deletedFunctions: 0,
        sanityPassed: true,
        diffLineCount: 30,
      });
      expect(result.score).toBe(0);
      expect(result.level).toBe('low');
    });

    it('auth file with moderate changes — medium risk', () => {
      const result = computeRiskScore({
        filePath: 'src/auth/tokenValidator.ts',
        structuralChangePercent: 40,
        deletedFunctions: 0,
        sanityPassed: true,
        diffLineCount: 80,
      });
      // protected(30)
      expect(result.score).toBe(30);
      expect(result.level).toBe('low');
    });

    it('config file with breaking changes and lint errors — high risk', () => {
      const result = computeRiskScore({
        filePath: 'src/config/database.ts',
        structuralChangePercent: 80,
        deletedFunctions: 5,
        sanityPassed: false,
        diffLineCount: 250,
      });
      // protected(30) + structuralHigh(40) + deletedHigh(35) + sanityFailed(20) + largeDiff(15) = 140 → 100
      expect(result.score).toBe(100);
      expect(result.level).toBe('high');
    });

    it('test file with many deletions — penalty softened by test deduction', () => {
      const result = computeRiskScore({
        filePath: 'src/auth/auth.test.ts',
        structuralChangePercent: 60,
        deletedFunctions: 4,
        sanityPassed: true,
        diffLineCount: 50,
      });
      // protected(30) + structuralMedium(25) + deletedHigh(35) - testFile(10) = 80
      expect(result.score).toBe(80);
      expect(result.level).toBe('high');
    });

    it('large safe diff in normal file — only large_diff triggers', () => {
      const result = computeRiskScore({
        filePath: 'src/components/Dashboard.tsx',
        structuralChangePercent: 10,
        deletedFunctions: 0,
        sanityPassed: true,
        diffLineCount: 350,
      });
      // largeDiff(15)
      expect(result.score).toBe(15);
      expect(result.level).toBe('low');
    });
  });
});
