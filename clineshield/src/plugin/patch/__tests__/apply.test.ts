import { applyOperation } from '../apply';
import { editorInputToOperation, parseApplyPatch } from '..';

const patchOp = (body: string[]) =>
  parseApplyPatch(['*** Begin Patch', ...body, '*** End Patch'].join('\n')).operations[0];

describe('applyOperation', () => {
  const file = 'a\nb\nc\nd\n';

  it('applies an apply_patch update hunk', () => {
    const r = applyOperation(file, patchOp(['*** Update File: f.ts', '@@', ' b', '-c', '+C']));
    expect(r).toEqual({ ok: true, text: 'a\nb\nC\nd\n' });
  });

  it('applies two hunks in order', () => {
    const r = applyOperation(file, patchOp(['*** Update File: f.ts', '@@', '-a', '+A', '@@', '-d', '+D']));
    expect(r).toEqual({ ok: true, text: 'A\nb\nc\nD\n' });
  });

  it('matches with trailing whitespace differences', () => {
    const r = applyOperation('a  \nb\n', patchOp(['*** Update File: f.ts', '@@', ' a', '-b', '+B']));
    expect(r.ok).toBe(true);
  });

  it('applies to a CRLF file without counting line endings as changes', () => {
    const r = applyOperation('a\r\nb\r\n', patchOp(['*** Update File: f.ts', '@@', ' a', '-b', '+B']));
    expect(r).toEqual({ ok: true, text: 'a\r\nB\r\n' });
  });

  it('fails when the old block is not in the file', () => {
    const r = applyOperation(file, patchOp(['*** Update File: f.ts', '@@', '-zzz', '+y']));
    expect(r.ok).toBe(false);
  });

  it('editor replace: old_text must occur exactly once', () => {
    const op = editorInputToOperation({ path: 'f.ts', old_text: 'b\n', new_text: 'B\n' })!;
    expect(applyOperation(file, op)).toEqual({ ok: true, text: 'a\nB\nc\nd\n' });
    expect(applyOperation('b\nb\n', op).ok).toBe(false);
  });

  it('editor insert_line inserts before that line', () => {
    const op = editorInputToOperation({ path: 'f.ts', new_text: 'X', insert_line: 2 })!;
    expect(applyOperation(file, op)).toEqual({ ok: true, text: 'a\nX\nb\nc\nd\n' });
  });

  it('add and delete', () => {
    expect(applyOperation('', patchOp(['*** Add File: n.ts', '+x', '+y']))).toEqual({ ok: true, text: 'x\ny' });
    expect(applyOperation(file, patchOp(['*** Delete File: f.ts']))).toEqual({ ok: true, text: '' });
  });
});
