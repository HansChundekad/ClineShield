const { analyzeStructuralChange } = require('../clineshield-analyze');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('analyzeStructuralChange', () => {
  let tempDir;
  let beforeFile;
  let afterFile;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clineshield-test-'));
    beforeFile = path.join(tempDir, 'before.ts');
    afterFile = path.join(tempDir, 'after.ts');
  });

  afterEach(() => {
    // Clean up temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Error Handling', () => {
    test('should return error when beforePath does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'nonexistent.ts');
      fs.writeFileSync(afterFile, 'export const x = 1;');

      const result = analyzeStructuralChange(nonExistentPath, afterFile);

      expect(result).toEqual({
        error: `File not found: ${nonExistentPath}`,
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      });
    });

    test('should return error when afterPath does not exist', () => {
      const nonExistentPath = path.join(tempDir, 'nonexistent.ts');
      fs.writeFileSync(beforeFile, 'export const x = 1;');

      const result = analyzeStructuralChange(beforeFile, nonExistentPath);

      expect(result).toEqual({
        error: `File not found: ${nonExistentPath}`,
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      });
    });

    // TODO: Phase 3 - Add stricter syntax validation using TypeScript diagnostics
    // ts-morph with allowJs is very permissive and doesn't fail on malformed syntax
    test('should handle files with syntax errors gracefully (current behavior)', () => {
      fs.writeFileSync(beforeFile, 'const x = {{{invalid syntax');
      fs.writeFileSync(afterFile, 'export const x = 1;');

      const result = analyzeStructuralChange(beforeFile, afterFile);

      // Phase 1-2: ts-morph is permissive, returns placeholder values
      // This is acceptable for now - real validation comes in Phase 3
      expect(result).toEqual({
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      });
      expect(result).not.toHaveProperty('error');
    });
  });

  describe('Deleted Functions Detection', () => {
    test('should return 0 deleted functions for identical files', () => {
      const content = 'export const x = 1;';
      fs.writeFileSync(beforeFile, content);
      fs.writeFileSync(afterFile, content);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toEqual({
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      });
      expect(result).not.toHaveProperty('error');
    });

    test('should detect deleted top-level functions', () => {
      fs.writeFileSync(beforeFile, `
        export function foo() { return 1; }
        export function bar() { return 2; }
        export function baz() { return 3; }
      `);
      fs.writeFileSync(afterFile, `
        export function foo() { return 1; }
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toEqual({
        structuralChangePercent: 50, // (2 deleted + 0 added) / 4 total = 50%
        deletedFunctions: 2, // bar and baz deleted
        deletedExports: 2 // bar and baz exports deleted
      });
      expect(result).not.toHaveProperty('error');
    });

    test('should detect deleted class methods', () => {
      fs.writeFileSync(beforeFile, `
        export class MyClass {
          method1() {}
          method2() {}
          method3() {}
        }
      `);
      fs.writeFileSync(afterFile, `
        export class MyClass {
          method1() {}
        }
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toEqual({
        structuralChangePercent: 50, // (2 deleted + 0 added) / 4 total = 50%
        deletedFunctions: 2, // method2 and method3 deleted
        deletedExports: 0 // Class itself not deleted
      });
      expect(result).not.toHaveProperty('error');
    });

    test('should detect deleted arrow functions', () => {
      fs.writeFileSync(beforeFile, `
        export const arrow1 = () => { return 1; };
        export const arrow2 = () => { return 2; };
      `);
      fs.writeFileSync(afterFile, `
        export const arrow1 = () => { return 1; };
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toEqual({
        structuralChangePercent: 33, // (1 deleted + 0 added) / 3 total = 33.3% rounded to 33
        deletedFunctions: 1, // arrow2 deleted
        deletedExports: 1 // arrow2 export deleted
      });
      expect(result).not.toHaveProperty('error');
    });

    test('should detect mixed function deletions', () => {
      fs.writeFileSync(beforeFile, `
        export function regularFunc() {}
        export const arrowFunc = () => {};
        export class Calculator {
          add() {}
          subtract() {}
        }
      `);
      fs.writeFileSync(afterFile, `
        export function regularFunc() {}
        export class Calculator {
          add() {}
        }
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toEqual({
        structuralChangePercent: 33, // (2 deleted + 0 added) / 6 total = 33.3% rounded to 33
        deletedFunctions: 2, // arrowFunc and Calculator.subtract deleted
        deletedExports: 1 // arrowFunc export deleted
      });
      expect(result).not.toHaveProperty('error');
    });

    test('should return 0 deleted functions when functions are added but not deleted', () => {
      fs.writeFileSync(beforeFile, `
        export function foo() {}
      `);
      fs.writeFileSync(afterFile, `
        export function foo() {}
        export function bar() {}
        export function baz() {}
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toEqual({
        structuralChangePercent: 50, // (0 deleted + 2 added) / 4 total = 50%
        deletedFunctions: 0, // No functions deleted, only added
        deletedExports: 0
      });
      expect(result).not.toHaveProperty('error');
    });

    test('should handle JavaScript files with deleted functions', () => {
      const jsBeforeFile = path.join(tempDir, 'before.js');
      const jsAfterFile = path.join(tempDir, 'after.js');

      fs.writeFileSync(jsBeforeFile, `
        function foo() { return 1; }
        function bar() { return 2; }
      `);
      fs.writeFileSync(jsAfterFile, `
        function foo() { return 1; }
      `);

      const result = analyzeStructuralChange(jsBeforeFile, jsAfterFile);

      expect(result).toEqual({
        structuralChangePercent: 33, // (1 deleted + 0 added) / 3 total = 33.3% rounded to 33
        deletedFunctions: 1, // bar deleted
        deletedExports: 0 // No exports in plain JS
      });
      expect(result).not.toHaveProperty('error');
    });

    test('should handle files with no functions', () => {
      fs.writeFileSync(beforeFile, 'export const x = 1;');
      fs.writeFileSync(afterFile, 'export const x = 2; export const y = 3;');

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toEqual({
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      });
      expect(result).not.toHaveProperty('error');
    });
  });

  describe('Structural Change Percentage', () => {
    test('should calculate 0% change for identical files', () => {
      const content = 'export function foo() {}';
      fs.writeFileSync(beforeFile, content);
      fs.writeFileSync(afterFile, content);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result.structuralChangePercent).toBe(0);
      expect(result.deletedFunctions).toBe(0);
    });

    test('should calculate 33% for large deletions (10 → 5)', () => {
      fs.writeFileSync(beforeFile, `
        export function f1() {}
        export function f2() {}
        export function f3() {}
        export function f4() {}
        export function f5() {}
        export function f6() {}
        export function f7() {}
        export function f8() {}
        export function f9() {}
        export function f10() {}
      `);
      fs.writeFileSync(afterFile, `
        export function f1() {}
        export function f2() {}
        export function f3() {}
        export function f4() {}
        export function f5() {}
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result.structuralChangePercent).toBe(33); // (5+0)/15 = 33.3% rounded to 33
      expect(result.deletedFunctions).toBe(5);
    });

    test('should calculate 33% for large additions (5 → 10)', () => {
      fs.writeFileSync(beforeFile, `
        export function f1() {}
        export function f2() {}
        export function f3() {}
        export function f4() {}
        export function f5() {}
      `);
      fs.writeFileSync(afterFile, `
        export function f1() {}
        export function f2() {}
        export function f3() {}
        export function f4() {}
        export function f5() {}
        export function f6() {}
        export function f7() {}
        export function f8() {}
        export function f9() {}
        export function f10() {}
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result.structuralChangePercent).toBe(33); // (0+5)/15 = 33.3% rounded to 33
      expect(result.deletedFunctions).toBe(0);
    });

    test('should calculate 50% when replacing half the functions', () => {
      fs.writeFileSync(beforeFile, `
        export function f1() {}
        export function f2() {}
        export function f3() {}
        export function f4() {}
        export function oldFunc1() {}
        export function oldFunc2() {}
        export function oldFunc3() {}
        export function oldFunc4() {}
      `);
      fs.writeFileSync(afterFile, `
        export function f1() {}
        export function f2() {}
        export function f3() {}
        export function f4() {}
        export function newFunc1() {}
        export function newFunc2() {}
        export function newFunc3() {}
        export function newFunc4() {}
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result.structuralChangePercent).toBe(50); // (4+4)/16 = 50%
      expect(result.deletedFunctions).toBe(4);
    });

    test('should handle empty files without division by zero', () => {
      fs.writeFileSync(beforeFile, '');
      fs.writeFileSync(afterFile, '');

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result.structuralChangePercent).toBe(0);
      expect(result.deletedFunctions).toBe(0);
    });
  });

  describe('Deleted Exports Detection', () => {
    test('should detect deleted exports', () => {
      fs.writeFileSync(beforeFile, `
        export function foo() {}
        export function bar() {}
        export const x = 1;
      `);
      fs.writeFileSync(afterFile, `
        export function foo() {}
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result.deletedExports).toBe(2); // bar and x deleted
    });

    test('should return 0 when no exports deleted', () => {
      fs.writeFileSync(beforeFile, `
        export function foo() {}
      `);
      fs.writeFileSync(afterFile, `
        export function foo() {}
        export function bar() {}
      `);

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result.deletedExports).toBe(0);
    });
  });

  describe('Response Structure', () => {
    test('should always include all required fields on success', () => {
      fs.writeFileSync(beforeFile, 'export const x = 1;');
      fs.writeFileSync(afterFile, 'export const x = 1;');

      const result = analyzeStructuralChange(beforeFile, afterFile);

      expect(result).toHaveProperty('structuralChangePercent');
      expect(result).toHaveProperty('deletedFunctions');
      expect(result).toHaveProperty('deletedExports');
      expect(typeof result.structuralChangePercent).toBe('number');
      expect(typeof result.deletedFunctions).toBe('number');
      expect(typeof result.deletedExports).toBe('number');
    });

    test('should always include all required fields on error', () => {
      const result = analyzeStructuralChange('/nonexistent/path.ts', afterFile);

      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('structuralChangePercent');
      expect(result).toHaveProperty('deletedFunctions');
      expect(result).toHaveProperty('deletedExports');
      expect(typeof result.error).toBe('string');
      expect(typeof result.structuralChangePercent).toBe('number');
      expect(typeof result.deletedFunctions).toBe('number');
      expect(typeof result.deletedExports).toBe('number');
    });
  });
});
