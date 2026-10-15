import { applyPatchInputText, parseApplyPatch } from '../index';

const patch = (...lines: string[]) => lines.join('\n');

describe('parseApplyPatch', () => {
  it('parses a single Update File with one hunk, keeping exact line text and order', () => {
    const parsed = parseApplyPatch(
      patch(
        '*** Begin Patch',
        '*** Update File: src/a.ts',
        '@@ function main() {',
        ' const a = 1;',
        '-  const b = 2;',
        '+  const b = 3;',
        '+',
        '   return a + b;',
        '*** End Patch'
      )
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.operations).toEqual([
      {
        type: 'update',
        path: 'src/a.ts',
        hunks: [
          {
            header: 'function main() {',
            endOfFile: false,
            lines: [
              { kind: 'context', text: 'const a = 1;' },
              { kind: 'remove', text: '  const b = 2;' },
              { kind: 'add', text: '  const b = 3;' },
              { kind: 'add', text: '' },
              { kind: 'context', text: '  return a + b;' },
            ],
          },
        ],
      },
    ]);
  });

  it('splits hunks on @@ and records a bare @@ as an empty header', () => {
    const parsed = parseApplyPatch(
      patch('*** Begin Patch', '*** Update File: a.ts', '@@', '-x', '+y', '@@ class Foo', ' z', '+w', '*** End Patch')
    );
    const op = parsed.operations[0];
    expect(op.type).toBe('update');
    if (op.type !== 'update') return;
    expect(op.hunks.map(h => h.header)).toEqual(['', 'class Foo']);
    expect(op.hunks[1].lines).toEqual([
      { kind: 'context', text: 'z' },
      { kind: 'add', text: 'w' },
    ]);
  });

  it('accepts a first hunk without an @@ header (header undefined)', () => {
    const parsed = parseApplyPatch(patch('*** Begin Patch', '*** Update File: a.ts', ' keep', '-old', '+new', '*** End Patch'));
    const op = parsed.operations[0];
    if (op.type !== 'update') throw new Error('expected update');
    expect(op.hunks).toHaveLength(1);
    expect(op.hunks[0].header).toBeUndefined();
    expect(op.hunks[0].lines).toHaveLength(3);
  });

  it('marks the hunk before *** End of File as endOfFile', () => {
    const parsed = parseApplyPatch(
      patch('*** Begin Patch', '*** Update File: a.ts', '@@', ' last', '+appended', '*** End of File', '*** End Patch')
    );
    const op = parsed.operations[0];
    if (op.type !== 'update') throw new Error('expected update');
    expect(op.hunks[0].endOfFile).toBe(true);
  });

  it('parses Move to on an update', () => {
    const parsed = parseApplyPatch(
      patch('*** Begin Patch', '*** Update File: old.ts', '*** Move to: new.ts', '@@', '-a', '+b', '*** End Patch')
    );
    expect(parsed.operations[0]).toMatchObject({ type: 'update', path: 'old.ts', moveTo: 'new.ts' });
  });

  it('parses Add File content without the + prefix', () => {
    const parsed = parseApplyPatch(
      patch('*** Begin Patch', '*** Add File: new.ts', '+export const x = 1;', '+', '+// end', '*** End Patch')
    );
    expect(parsed.operations).toEqual([{ type: 'add', path: 'new.ts', lines: ['export const x = 1;', '', '// end'] }]);
  });

  it('parses Delete File', () => {
    const parsed = parseApplyPatch(patch('*** Begin Patch', '*** Delete File: gone.ts', '*** End Patch'));
    expect(parsed.operations).toEqual([{ type: 'delete', path: 'gone.ts' }]);
  });

  it('parses multi-file patches in order', () => {
    const parsed = parseApplyPatch(
      patch(
        '*** Begin Patch',
        '*** Add File: a.md',
        '+hi',
        '*** Update File: b.ts',
        '@@',
        '-x',
        '*** Delete File: c.js',
        '*** Update File: d.tsx',
        '@@',
        '+y',
        '*** End Patch'
      )
    );
    expect(parsed.operations.map(o => `${o.type}:${o.path}`)).toEqual(['add:a.md', 'update:b.ts', 'delete:c.js', 'update:d.tsx']);
  });

  it('treats unprefixed lines inside a hunk as context (upstream behaviour)', () => {
    const parsed = parseApplyPatch(patch('*** Begin Patch', '*** Update File: a.ts', '@@', 'bare line', '-x', '*** End Patch'));
    const op = parsed.operations[0];
    if (op.type !== 'update') throw new Error('expected update');
    expect(op.hunks[0].lines[0]).toEqual({ kind: 'context', text: 'bare line' });
  });

  it('keeps blank lines inside a hunk as empty context lines', () => {
    const parsed = parseApplyPatch(patch('*** Begin Patch', '*** Update File: a.ts', '@@', ' a', '', '-b', '*** End Patch'));
    const op = parsed.operations[0];
    if (op.type !== 'update') throw new Error('expected update');
    expect(op.hunks[0].lines).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'context', text: '' },
      { kind: 'remove', text: 'b' },
    ]);
  });

  it('strips CR from CRLF input', () => {
    const parsed = parseApplyPatch('*** Begin Patch\r\n*** Update File: a.ts\r\n@@\r\n-x\r\n+y\r\n*** End Patch\r\n');
    const op = parsed.operations[0];
    if (op.type !== 'update') throw new Error('expected update');
    expect(op.hunks[0].lines).toEqual([
      { kind: 'remove', text: 'x' },
      { kind: 'add', text: 'y' },
    ]);
  });

  it('ignores text outside the Begin/End sentinels', () => {
    const parsed = parseApplyPatch(
      patch('apply_patch <<"EOF"', '*** Begin Patch', '*** Delete File: a.ts', '*** End Patch', 'EOF')
    );
    expect(parsed.operations).toEqual([{ type: 'delete', path: 'a.ts' }]);
    expect(parsed.warnings).toEqual([]);
  });

  it('accepts a patch body without sentinels (wrapper lines trimmed)', () => {
    const parsed = parseApplyPatch(patch('```', '*** Update File: a.ts', '@@', '-x', '```'));
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].path).toBe('a.ts');
  });

  it('warns but still parses when only one sentinel is present', () => {
    const parsed = parseApplyPatch(patch('*** Begin Patch', '*** Update File: a.ts', '@@', '-x'));
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.warnings.join('\n')).toMatch(/sentinel/i);
  });

  it('warns about lines outside any file section and Add File lines without +', () => {
    const parsed = parseApplyPatch(
      patch('*** Begin Patch', 'stray line', '*** Add File: a.ts', 'no plus', '*** End Patch')
    );
    expect(parsed.operations).toEqual([{ type: 'add', path: 'a.ts', lines: [] }]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it('returns no operations (and never throws) for empty or garbage input', () => {
    expect(parseApplyPatch('').operations).toEqual([]);
    expect(parseApplyPatch('*** Begin Patch\n*** End Patch').operations).toEqual([]);
    expect(() => parseApplyPatch('*** Frobnicate: x\n@@@\n')).not.toThrow();
  });

  it('parses the 1.x TESTING.md cases', () => {
    const t1 = parseApplyPatch(
      '*** Begin Patch\n*** Update File: test.ts\n@@\n context();\n+\n+ function newFunc() {\n+   return 42;\n+ }\n*** End Patch'
    );
    const op1 = t1.operations[0];
    if (op1.type !== 'update') throw new Error('expected update');
    expect(op1.hunks[0].lines.map(l => l.kind)).toEqual(['context', 'add', 'add', 'add', 'add']);

    const t2 = parseApplyPatch(
      '*** Begin Patch\n*** Update File: test.ts\n@@\n- function a() {}\n- function b() {}\n- function c() {}\n- function d() {}\n*** End Patch'
    );
    const op2 = t2.operations[0];
    if (op2.type !== 'update') throw new Error('expected update');
    expect(op2.hunks[0].lines.every(l => l.kind === 'remove')).toBe(true);
    expect(op2.hunks[0].lines[0].text).toBe(' function a() {}');
  });
});

describe('applyPatchInputText', () => {
  it('reads the canonical { input } shape', () => {
    expect(applyPatchInputText({ input: 'x' })).toBe('x');
  });

  it('reads the bare string shape', () => {
    expect(applyPatchInputText('x')).toBe('x');
  });

  it('returns undefined for anything else', () => {
    expect(applyPatchInputText(undefined)).toBeUndefined();
    expect(applyPatchInputText({ input: 3 })).toBeUndefined();
    expect(applyPatchInputText({ patch: 'x' })).toBeUndefined();
    expect(applyPatchInputText(null)).toBeUndefined();
  });
});
