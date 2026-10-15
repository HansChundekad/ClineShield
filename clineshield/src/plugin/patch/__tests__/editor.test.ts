import { editorInputToOperation } from '../index';

describe('editorInputToOperation', () => {
  it('turns a replacement into an update hunk, unchanged lines as context', () => {
    const op = editorInputToOperation({
      path: '/w/src/a.ts',
      old_text: 'function a() {\n  return 1;\n}',
      new_text: 'function a() {\n  return 2;\n}',
    });
    expect(op).toEqual({
      type: 'update',
      path: '/w/src/a.ts',
      hunks: [
        {
          endOfFile: false,
          exactText: { oldText: 'function a() {\n  return 1;\n}', newText: 'function a() {\n  return 2;\n}' },
          lines: [
            { kind: 'context', text: 'function a() {' },
            { kind: 'remove', text: '  return 1;' },
            { kind: 'add', text: '  return 2;' },
            { kind: 'context', text: '}' },
          ],
        },
      ],
    });
  });

  it('context + removed lines reproduce old_text and context + added lines reproduce new_text', () => {
    const oldText = 'a\nb\nc\nd\ne\n';
    const newText = 'a\nX\nc\nY\nZ\ne\n';
    const op = editorInputToOperation({ path: 'f.ts', old_text: oldText, new_text: newText });
    if (op?.type !== 'update') throw new Error('expected update');
    const lines = op.hunks[0].lines;
    const oldSide = lines.filter(l => l.kind !== 'add').map(l => l.text).join('\n') + '\n';
    const newSide = lines.filter(l => l.kind !== 'remove').map(l => l.text).join('\n') + '\n';
    expect(oldSide).toBe(oldText);
    expect(newSide).toBe(newText);
  });

  it('keeps sub-line replacements exact in exactText', () => {
    const op = editorInputToOperation({ path: 'f.ts', old_text: 'foo(1)', new_text: 'foo(2)' });
    if (op?.type !== 'update') throw new Error('expected update');
    expect(op.hunks[0].exactText).toEqual({ oldText: 'foo(1)', newText: 'foo(2)' });
    expect(op.hunks[0].lines).toEqual([
      { kind: 'remove', text: 'foo(1)' },
      { kind: 'add', text: 'foo(2)' },
    ]);
  });

  it('turns an insert into an add-only hunk anchored at insert_line', () => {
    const op = editorInputToOperation({ path: 'f.ts', new_text: 'x\ny\n', insert_line: 4 });
    expect(op).toEqual({
      type: 'update',
      path: 'f.ts',
      hunks: [
        {
          endOfFile: false,
          insertAtLine: 4,
          exactText: { oldText: '', newText: 'x\ny\n' },
          lines: [
            { kind: 'add', text: 'x' },
            { kind: 'add', text: 'y' },
          ],
        },
      ],
    });
  });

  it('coerces a stringified insert_line', () => {
    const op = editorInputToOperation({ path: 'f.ts', new_text: 'x', insert_line: '2' });
    if (op?.type !== 'update') throw new Error('expected update');
    expect(op.hunks[0].insertAtLine).toBe(2);
  });

  it('treats a missing or null old_text without insert_line as file creation', () => {
    expect(editorInputToOperation({ path: 'n.ts', new_text: 'a\nb' })).toEqual({ type: 'add', path: 'n.ts', lines: ['a', 'b'] });
    expect(editorInputToOperation({ path: 'n.ts', old_text: null, new_text: 'a', insert_line: null })).toEqual({
      type: 'add',
      path: 'n.ts',
      lines: ['a'],
    });
  });

  it('returns undefined for malformed input', () => {
    expect(editorInputToOperation(undefined)).toBeUndefined();
    expect(editorInputToOperation('x')).toBeUndefined();
    expect(editorInputToOperation({ path: '', new_text: 'x' })).toBeUndefined();
    expect(editorInputToOperation({ path: 'a.ts' })).toBeUndefined();
  });

  it('stays correct and fast for very large replacements (falls back past the LCS budget)', () => {
    const oldLines = Array.from({ length: 3000 }, (_, i) => `const a${i} = ${i};`);
    const newLines = Array.from({ length: 3000 }, (_, i) => `const b${i} = ${i};`);
    const start = Date.now();
    const op = editorInputToOperation({ path: 'f.ts', old_text: oldLines.join('\n'), new_text: newLines.join('\n') });
    expect(Date.now() - start).toBeLessThan(200);
    if (op?.type !== 'update') throw new Error('expected update');
    const lines = op.hunks[0].lines;
    expect(lines.filter(l => l.kind === 'remove').map(l => l.text)).toEqual(oldLines);
    expect(lines.filter(l => l.kind === 'add').map(l => l.text)).toEqual(newLines);
  });
});
