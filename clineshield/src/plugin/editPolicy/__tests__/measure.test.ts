import { editorInputToOperation, parseApplyPatch } from '../../patch';
import type { FileOperation } from '../../patch';
import { looksLikeExport, looksLikeFunctionSignature, measureOperation } from '../measure';

const firstOp = (text: string): FileOperation => parseApplyPatch(text).operations[0];

describe('looksLikeFunctionSignature (1.x regex port)', () => {
  it.each([
    'function foo() {',
    ' function a() {}',
    'async function load(x) {',
    'export function run() {',
    'export async function run() {',
    'export default function handler(req) {',
    'const add = (a, b) => a + b;',
    'const load = async () => {',
  ])('detects %p', line => {
    expect(looksLikeFunctionSignature(line)).toBe(true);
  });

  it.each(['if (x) {', 'foo();', 'return x => x;', 'let x = 1;', '  method() {', '// function in a comment without parens'])(
    'ignores %p',
    line => {
      expect(looksLikeFunctionSignature(line)).toBe(false);
    }
  );
});

describe('looksLikeExport', () => {
  it.each(['export const x = 1;', '  export function f() {}', 'export default App;', 'export { a, b };', 'export * from "./x";'])(
    'detects %p',
    line => expect(looksLikeExport(line)).toBe(true)
  );
  it.each(['const exported = 1;', '// export later', 'module.exports = x;'])('ignores %p', line =>
    expect(looksLikeExport(line)).toBe(false)
  );
});

describe('measureOperation', () => {
  it('TESTING.md test 1: function addition → 5 lines, 80%, nothing deleted', () => {
    const m = measureOperation(
      firstOp('*** Begin Patch\n*** Update File: test.ts\n@@\n context();\n+\n+ function newFunc() {\n+   return 42;\n+ }\n*** End Patch')
    );
    expect(m).toEqual({
      path: 'test.ts',
      operation: 'update',
      addedLines: 4,
      removedLines: 0,
      contextLines: 1,
      patchLines: 5,
      structuralChangePercent: 80,
      functionsAdded: 1,
      functionsDeleted: 0,
      exportsDeleted: 0,
    });
  });

  it('TESTING.md test 2: four function deletions → 4 deleted, 100%', () => {
    const m = measureOperation(
      firstOp(
        '*** Begin Patch\n*** Update File: test.ts\n@@\n- function a() {}\n- function b() {}\n- function c() {}\n- function d() {}\n*** End Patch'
      )
    );
    expect(m.functionsDeleted).toBe(4);
    expect(m.structuralChangePercent).toBe(100);
    expect(m.patchLines).toBe(4);
  });

  it('TESTING.md test 3: 8 of 9 lines changed → 88% (integer floor, as 1.x)', () => {
    const m = measureOperation(
      firstOp(
        '*** Begin Patch\n*** Update File: test.ts\n@@\n- old line 1\n- old line 2\n- old line 3\n+ new line 1\n+ new line 2\n+ new line 3\n+ new line 4\n+ new line 5\n context\n*** End Patch'
      )
    );
    expect(m.structuralChangePercent).toBe(88);
    expect(m.patchLines).toBe(9);
  });

  it('counts deleted exports', () => {
    const m = measureOperation(
      firstOp('*** Begin Patch\n*** Update File: a.ts\n@@\n-export const a = 1;\n-export function b() {}\n+const a = 1;\n*** End Patch')
    );
    expect(m.exportsDeleted).toBe(2);
    expect(m.functionsDeleted).toBe(1);
  });

  it('sums all hunks of a file', () => {
    const m = measureOperation(firstOp('*** Begin Patch\n*** Update File: a.ts\n@@\n x\n-y\n@@\n z\n+w\n*** End Patch'));
    expect(m).toMatchObject({ addedLines: 1, removedLines: 1, contextLines: 2, patchLines: 4, structuralChangePercent: 50 });
  });

  it('measures an editor replacement using its unchanged lines as context', () => {
    const op = editorInputToOperation({
      path: 'a.ts',
      old_text: 'function a() {\n  return 1;\n}',
      new_text: 'function a() {\n  return 2;\n}',
    });
    const m = measureOperation(op!);
    expect(m).toMatchObject({ removedLines: 1, addedLines: 1, contextLines: 2, patchLines: 4, structuralChangePercent: 50, functionsDeleted: 0 });
  });

  it('measures an Add File as all added lines', () => {
    const m = measureOperation({ type: 'add', path: 'n.ts', lines: ['export function a() {}', 'x'] });
    expect(m).toMatchObject({ operation: 'add', addedLines: 2, patchLines: 2, structuralChangePercent: 100, functionsAdded: 1, functionsDeleted: 0 });
  });

  it('measures a Delete File as zero (file content is unknown to the parser)', () => {
    const m = measureOperation({ type: 'delete', path: 'g.ts' });
    expect(m).toMatchObject({ operation: 'delete', patchLines: 0, structuralChangePercent: 0, functionsDeleted: 0 });
  });

  it('reports 0% for an empty update', () => {
    expect(measureOperation({ type: 'update', path: 'a.ts', hunks: [] }).structuralChangePercent).toBe(0);
  });
});
