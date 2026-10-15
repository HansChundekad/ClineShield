import { fileOpsCheck, filesTouched, locationCheck, rewriteShare, sensitiveCheck, sizeCheck } from '../files';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';
import type { Check } from '../../types';

const run = (check: Check, c: ReturnType<typeof change>, opts = OPTS) => check.run(c, action([c]), opts);
const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const file = (n: number) => lines(n).join('\n') + '\n';

describe('rewriteShare', () => {
  it('is file-relative when the original is known', () => {
    const c = change(update('a.ts', lines(10), ['x'], []), { original: file(40) });
    c.matched = true;
    expect(rewriteShare(c)).toBe(0.25);
  });
  it('falls back to patch-relative for unknown originals, only above 10 patch lines', () => {
    expect(rewriteShare(change(update('a.ts', lines(8), lines(8, 'n'), ['c1', 'c2'])))).toBeCloseTo(16 / 18);
    expect(rewriteShare(change(update('a.ts', ['a'], ['b'])))).toBeUndefined();
  });
  it('ignores small files (< 20 lines)', () => {
    const c = change(update('a.ts', lines(10), [], []), { original: file(10) });
    c.matched = true;
    expect(rewriteShare(c)).toBeUndefined();
  });
});

describe('sizeCheck', () => {
  const sized = (removed: number, total: number) => {
    const c = change(update('a.ts', lines(removed), ['x'], []), { original: file(total) });
    c.matched = true;
    return c;
  };
  it('small edit to a big file: nothing', () => expect(run(sizeCheck, sized(3, 2000))).toEqual([]));
  it('≥ 40 % → half weight, ≥ 75 % → full', () => {
    expect(run(sizeCheck, sized(20, 40))).toEqual([expect.objectContaining({ category: 'rewrite_share', weight: 0.5 })]);
    expect(run(sizeCheck, sized(38, 40))).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'rewrite_share', weight: 1 })]));
  });
  it('lines removed bands and deletion-heavy', () => {
    const c = sized(150, 2000);
    expect(ids(run(sizeCheck, c)).sort()).toEqual(['deletion_heavy', 'lines_removed']);
    expect(run(sizeCheck, sized(301, 20000)).find(f => f.category === 'lines_removed')?.weight).toBe(1);
  });
  it('new files never score size', () => {
    expect(run(sizeCheck, change(['*** Add File: n.ts', ...lines(400).map(l => `+${l}`)]))).toEqual([]);
  });
});

describe('filesTouched', () => {
  it('bands on the number of files in the action', () => {
    const cs = (n: number) => Array.from({ length: n }, (_, i) => change(update(`f${i}.ts`, ['a'], ['b'])));
    expect(filesTouched.run(cs(5)[0], action(cs(5)), OPTS)).toEqual([]);
    expect(filesTouched.run(cs(6)[0], action(cs(6)), OPTS)[0].weight).toBe(0.5);
    expect(filesTouched.run(cs(16)[0], action(cs(16)), OPTS)[0].weight).toBe(1);
  });
});

describe('fileOpsCheck', () => {
  it('delete, delete with uncommitted changes', () => {
    expect(ids(run(fileOpsCheck, change(['*** Delete File: a.ts'])))).toEqual(['file_deleted']);
    expect(ids(run(fileOpsCheck, change(['*** Delete File: a.ts'], { gitDirty: true })))).toEqual(['file_deleted', 'uncommitted_lost']);
  });
  it('move onto an existing file, outside workspace', () => {
    const mv = change(['*** Update File: a.ts', '*** Move to: b.ts', '@@', '-a', '+b'], { moveTargetExists: true });
    expect(ids(run(fileOpsCheck, mv))).toEqual(['move_overwrites']);
    expect(ids(run(fileOpsCheck, change(update('/etc/x', ['a'], ['b']), { outsideWorkspace: true })))).toEqual(['outside_workspace']);
  });
  it('existing untracked file deleted, moved or rewritten ≥ 75% → uncommitted_lost', () => {
    const untracked = { exists: true, gitTracked: false };
    const del = run(fileOpsCheck, change(['*** Delete File: a.ts'], untracked));
    expect(ids(del)).toEqual(['file_deleted', 'uncommitted_lost']);
    expect(del[1].detail).toBe("a.ts is not tracked by git, so this can't be undone");
    expect(ids(run(fileOpsCheck, change(['*** Update File: a.ts', '*** Move to: b.ts', '@@', '-a', '+b'], untracked)))).toEqual(['uncommitted_lost']);
    const rw = change(update('a.ts', lines(38), ['x'], []), { ...untracked, original: file(40) });
    rw.matched = true;
    expect(ids(run(fileOpsCheck, rw))).toEqual(['uncommitted_lost']);
    expect(run(fileOpsCheck, change(update('a.ts', ['a'], ['b']), untracked))).toEqual([]);
    expect(ids(run(fileOpsCheck, change(['*** Delete File: a.ts'], { exists: false, gitTracked: false })))).toEqual(['file_deleted']);
  });
  it('deleting or moving onto a tracked, clean file is recoverable: -10 points', () => {
    const clean = { gitTracked: true, gitDirty: false };
    const [del] = run(fileOpsCheck, change(['*** Delete File: a.ts'], clean));
    expect(del).toMatchObject({ category: 'file_deleted', minus: 10, detail: 'deletes a.ts (recoverable from git)' });
    const [mv] = run(fileOpsCheck, change(['*** Update File: a.ts', '*** Move to: b.ts', '@@', '-a', '+b'], { ...clean, moveTargetExists: true }));
    expect(mv).toMatchObject({ category: 'move_overwrites', minus: 10 });
    expect(run(fileOpsCheck, change(['*** Delete File: a.ts'], { gitTracked: true, gitDirty: true }))[0].minus).toBeUndefined();
    expect(run(fileOpsCheck, change(['*** Delete File: a.ts']))[0].minus).toBeUndefined();
  });
  it('dirty file with a small edit is fine', () => {
    expect(run(fileOpsCheck, change(update('a.ts', ['a'], ['b']), { gitDirty: true }))).toEqual([]);
  });
});

describe('sensitiveCheck', () => {
  it.each([
    ['.env', 'secrets_file'], ['.github/workflows/ci.yml', 'ci_config'], ['Dockerfile', 'infra'],
    ['migrations/001.sql', 'migration'], ['.gitignore', 'gitignore_changed'],
  ])('%s → %s', (p, id) => expect(ids(run(sensitiveCheck, change(update(p, ['a'], ['b']))))).toEqual([id]));

  it('protected paths from config and CODEOWNERS', () => {
    const c = change(update('src/payments/pay.ts', ['a'], ['b']));
    expect(ids(sensitiveCheck.run(c, action([c]), { ...OPTS, protectedPaths: ['src/payments/**'] }))).toEqual(['protected_path']);
    expect(ids(sensitiveCheck.run(c, action([c], { codeownersGlobs: ['src/payments/**'] }), OPTS))).toEqual(['protected_path']);
  });

  it('gitignore un-ignoring secrets replaces the plain change finding', () => {
    expect(ids(run(sensitiveCheck, change(update('.gitignore', ['.env'], []))))).toEqual(['gitignore_unignores_secrets']);
    expect(ids(run(sensitiveCheck, change(update('.gitignore', [], ['!.env.local']))))).toEqual(['gitignore_unignores_secrets']);
  });

  it('checks the move target too', () => {
    const c = change(['*** Update File: notes.txt', '*** Move to: .env', '@@', '-a', '+b']);
    expect(ids(run(sensitiveCheck, c))).toEqual(['secrets_file']);
  });
});

describe('locationCheck', () => {
  it('manifest and generated', () => {
    expect(ids(run(locationCheck, change(update('package.json', ['a'], ['b']))))).toEqual(['manifest']);
    expect(ids(run(locationCheck, change(update('dist/a.js', ['a'], ['b']))))).toEqual(['generated']);
  });
});
