import type { EditMeasurement } from '../measure';
import { classifyEdit, EDIT_SIZE_THRESHOLDS, evaluateEdit, isGuardedPath } from '../policy';

function m(overrides: Partial<EditMeasurement>): EditMeasurement {
  return {
    path: 'a.ts',
    operation: 'update',
    addedLines: 0,
    removedLines: 0,
    contextLines: 0,
    patchLines: 0,
    structuralChangePercent: 0,
    functionsAdded: 0,
    functionsDeleted: 0,
    exportsDeleted: 0,
    ...overrides,
  };
}

/** A one-file apply_patch with `changed` removed lines and `context` context lines. */
function patchWith(changed: number, context: number, file = 'src/a.ts', removedLine = (i: number) => `-old ${i}`): string {
  const lines = ['*** Begin Patch', `*** Update File: ${file}`, '@@'];
  for (let i = 0; i < context; i++) lines.push(` keep ${i}`);
  for (let i = 0; i < changed; i++) lines.push(removedLine(i));
  lines.push('*** End Patch');
  return lines.join('\n');
}

describe('EDIT_SIZE_THRESHOLDS', () => {
  it('holds the SPEC defaults (Open decision #4)', () => {
    expect(EDIT_SIZE_THRESHOLDS).toEqual({
      minPatchLinesForPercent: 10,
      block: { functionsDeletedAbove: 3, changePercentAbove: 75 },
      approve: { functionsDeletedAtLeast: 2, changePercentAtLeast: 40 },
    });
  });
});

describe('classifyEdit — deleted functions', () => {
  it.each([
    [0, 'allow'],
    [1, 'allow'],
    [2, 'approve'],
    [3, 'approve'],
    [4, 'block'],
  ])('%i deleted functions → %s', (functionsDeleted, tier) => {
    expect(classifyEdit(m({ functionsDeleted, patchLines: 5, structuralChangePercent: 100 })).tier).toBe(tier);
  });
});

describe('classifyEdit — structural change %', () => {
  it('ignores the % on a patch of exactly 10 lines', () => {
    expect(classifyEdit(m({ patchLines: 10, structuralChangePercent: 100 })).tier).toBe('allow');
  });

  it('applies the % from 11 lines', () => {
    expect(classifyEdit(m({ patchLines: 11, structuralChangePercent: 100 })).tier).toBe('block');
  });

  it.each([
    [39, 'allow'],
    [40, 'approve'],
    [75, 'approve'],
    [76, 'block'],
  ])('%i%% on an 11-line patch → %s', (structuralChangePercent, tier) => {
    expect(classifyEdit(m({ patchLines: 11, structuralChangePercent })).tier).toBe(tier);
  });

  it('the worse of the two rules wins', () => {
    expect(classifyEdit(m({ functionsDeleted: 4, patchLines: 20, structuralChangePercent: 10 })).tier).toBe('block');
    expect(classifyEdit(m({ functionsDeleted: 2, patchLines: 20, structuralChangePercent: 90 })).tier).toBe('block');
    expect(classifyEdit(m({ functionsDeleted: 1, patchLines: 20, structuralChangePercent: 50 })).tier).toBe('approve');
  });

  it('explains each triggered rule', () => {
    const { reasons } = classifyEdit(m({ functionsDeleted: 4, patchLines: 20, structuralChangePercent: 90 }));
    expect(reasons).toEqual([
      '4 functions deleted (limit 3)',
      '90% of a 20-line patch changed (limit 75% for patches over 10 lines)',
    ]);
    expect(classifyEdit(m({ functionsDeleted: 2, patchLines: 20, structuralChangePercent: 50 })).reasons).toEqual([
      '2 functions deleted (approval needed from 2)',
      '50% of a 20-line patch changed (approval needed from 40% for patches over 10 lines)',
    ]);
    expect(classifyEdit(m({})).reasons).toEqual([]);
  });

  it('always allows creating a new file', () => {
    expect(classifyEdit(m({ operation: 'add', patchLines: 500, structuralChangePercent: 100 })).tier).toBe('allow');
  });
});

describe('classifyEdit with real patches at the boundaries', () => {
  const tierOf = (text: string) => evaluateEdit('apply_patch', { input: text })?.tier;

  it('10-line all-changed patch → allow; 11 lines → block', () => {
    expect(tierOf(patchWith(10, 0))).toBe('allow');
    expect(tierOf(patchWith(11, 0))).toBe('block');
  });

  it('39% / 40% / 75% / 76% of a 100-line patch', () => {
    expect(tierOf(patchWith(39, 61))).toBe('allow');
    expect(tierOf(patchWith(40, 60))).toBe('approve');
    expect(tierOf(patchWith(75, 25))).toBe('approve');
    expect(tierOf(patchWith(76, 24))).toBe('block');
  });

  it('1 / 2 / 3 / 4 deleted functions in a small patch', () => {
    const fn = (i: number) => `-function f${i}() {}`;
    expect(tierOf(patchWith(1, 0, 'a.ts', fn))).toBe('allow');
    expect(tierOf(patchWith(2, 0, 'a.ts', fn))).toBe('approve');
    expect(tierOf(patchWith(3, 0, 'a.ts', fn))).toBe('approve');
    expect(tierOf(patchWith(4, 0, 'a.ts', fn))).toBe('block');
  });
});

describe('isGuardedPath', () => {
  it.each(['a.ts', 'src/b.tsx', '/abs/c.js', 'd.jsx', 'e.mjs', 'f.cjs', 'g.mts', 'h.cts', 'X.TS'])('guards %p', p =>
    expect(isGuardedPath(p)).toBe(true)
  );
  it.each(['README.md', 'a.json', 'b.ts.bak', 'c.d', 'tsconfig', 'style.css'])('ignores %p', p =>
    expect(isGuardedPath(p)).toBe(false)
  );
});

describe('evaluateEdit', () => {
  it('returns undefined for non-edit tools', () => {
    expect(evaluateEdit('read_files', { files: [{ path: 'a.ts' }] })).toBeUndefined();
    expect(evaluateEdit('run_commands', { commands: ['rm -rf /'] })).toBeUndefined();
  });

  it('returns undefined when no TS/JS file is touched', () => {
    expect(evaluateEdit('apply_patch', { input: patchWith(50, 0, 'README.md') })).toBeUndefined();
    expect(evaluateEdit('editor', { path: '/w/notes.md', old_text: 'a', new_text: 'b' })).toBeUndefined();
  });

  it('returns undefined for malformed input', () => {
    expect(evaluateEdit('apply_patch', 42)).toBeUndefined();
    expect(evaluateEdit('editor', { path: 'a.ts' })).toBeUndefined();
  });

  it('does not evaluate Delete File operations (1.x behaviour, Open decision #8)', () => {
    expect(evaluateEdit('apply_patch', { input: '*** Begin Patch\n*** Delete File: a.ts\n*** End Patch' })).toBeUndefined();
  });

  it('evaluates an editor edit', () => {
    const d = evaluateEdit('editor', { path: '/w/a.ts', old_text: 'x', new_text: 'y' });
    expect(d?.tier).toBe('allow');
    expect(d?.files).toHaveLength(1);
    expect(d?.files[0].file).toBe('/w/a.ts');
  });

  it('maps file names through displayPath', () => {
    const d = evaluateEdit('editor', { path: '/w/src/a.ts', old_text: 'x', new_text: 'y' }, { displayPath: p => p.replace('/w/', '') });
    expect(d?.files[0].file).toBe('src/a.ts');
  });

  it('multi-file: evaluates each TS/JS file, worst tier wins, non-TS files skipped', () => {
    const text = [
      '*** Begin Patch',
      '*** Update File: small.ts',
      '@@',
      ' a',
      '-b',
      '+c',
      '*** Update File: README.md',
      '@@',
      ...Array.from({ length: 30 }, (_, i) => `-doc ${i}`),
      '*** Update File: big.js',
      '@@',
      ...Array.from({ length: 5 }, (_, i) => `-function f${i}() {}`),
      '*** End Patch',
    ].join('\n');
    const d = evaluateEdit('apply_patch', { input: text });
    expect(d?.tier).toBe('block');
    expect(d?.files.map(f => [f.file, f.tier])).toEqual([
      ['small.ts', 'allow'],
      ['big.js', 'block'],
    ]);
    expect(d?.message).toContain('big.js: 5 functions deleted (limit 3)');
    expect(d?.message).not.toContain('small.ts:');
  });

  it('block message is actionable', () => {
    const d = evaluateEdit('apply_patch', { input: patchWith(4, 0, 'a.ts', i => `-function f${i}() {}`) });
    expect(d?.message).toMatch(/^ClineShield blocked this edit/);
    expect(d?.message).toMatch(/nothing was changed/i);
    expect(d?.message).toMatch(/smaller/);
  });

  it('approval message explains why and what to do on rejection', () => {
    const d = evaluateEdit('apply_patch', { input: patchWith(50, 50) });
    expect(d?.tier).toBe('approve');
    expect(d?.message).toContain('src/a.ts: 50% of a 100-line patch changed');
    expect(d?.message).toMatch(/approve/);
    expect(d?.message).toMatch(/reject/);
  });

  it('allow decisions carry no message', () => {
    expect(evaluateEdit('apply_patch', { input: patchWith(1, 5) })?.message).toBe('');
  });
});

describe('performance', () => {
  it('evaluates a 20,000-line patch well under 200 ms', () => {
    const text = patchWith(10_000, 10_000, 'big.ts', i => (i % 50 === 0 ? `-export function f${i}() {` : `-  const v${i} = ${i};`));
    const start = process.hrtime.bigint();
    const d = evaluateEdit('apply_patch', { input: text });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(d?.tier).toBe('block');
    expect(ms).toBeLessThan(200);
  });
});
