import { sessionCheck } from '../session';
import { testAndSource } from '../tests';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';
import type { SessionView } from '../../session';
import type { FileChange } from '../../types';

export function fakeView(o: { failed?: boolean; churn?: number; prior?: Record<string, number>; known?: string[] } = {}): SessionView {
  return {
    lastTestFailed: o.failed ?? false,
    churn: o.churn ?? 0,
    priorEdits: p => o.prior?.[p] ?? 0,
    known: p => (o.known ?? []).includes(p),
    recentEdits: () => [],
  };
}
const existing = (file: string, removed: string[] = ['a'], added: string[] = ['b']): FileChange => change(update(file, removed, added), { exists: true });
const run = (c: FileChange, session: SessionView, all: FileChange[] = [c]) => sessionCheck.run(c, action(all, { session }), OPTS);
const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);

describe('sessionCheck', () => {
  it('no session view → nothing', () => {
    const c = existing('src/a.ts');
    expect(sessionCheck.run(c, action([c]), OPTS)).toEqual([]);
  });

  it('edit_loop at 4 prior edits fires, 3 does not', () => {
    const c = existing('src/a.ts');
    const known = ['src/a.ts'];
    const hit = run(c, fakeView({ prior: { 'src/a.ts': 4 }, known }));
    expect(ids(hit)).toEqual(['edit_loop']);
    expect(hit[0].detail).toBe('edit 5 of this file in 10 minutes (would add 15)');
    expect(run(c, fakeView({ prior: { 'src/a.ts': 3 }, known }))).toEqual([]);
  });

  it('unread_file fires only for an existing file Cline has not seen', () => {
    const c = existing('src/a.ts');
    const hit = run(c, fakeView());
    expect(ids(hit)).toEqual(['unread_file']);
    expect(hit[0].detail).toBe('edits src/a.ts without reading it first (would add 10)');
    expect(run(c, fakeView({ known: ['src/a.ts'] }))).toEqual([]);
    expect(run(change(['*** Add File: src/new.ts', '+x']), fakeView())).toEqual([]);
    expect(run(change(update('src/a.ts', ['a'], ['b'])), fakeView())).toEqual([]); // exists unknown
    const shell = existing('src/a.ts');
    shell.shellEdit = 'sed -i';
    expect(run(shell, fakeView())).toEqual([]);
  });

  it('session_churn: 1,000 total does not fire, 1,001 does, only on the first change', () => {
    const a = existing('src/a.ts', lines(5), lines(5)); // 10 lines
    const b = existing('src/b.ts', [], []);
    const known = ['src/a.ts', 'src/b.ts'];
    expect(run(a, fakeView({ churn: 990, known }), [a, b])).toEqual([]);
    const hit = run(a, fakeView({ churn: 991, known }), [a, b]);
    expect(ids(hit)).toEqual(['session_churn']);
    expect(hit[0].detail).toBe('1001 lines changed this session (would add 15)');
    expect(run(b, fakeView({ churn: 991, known }), [a, b])).toEqual([]);
  });
});

describe('test_and_source with session memory', () => {
  const t = change(update('src/a.test.ts', ['a'], ['b']));
  const s = change(update('src/a.ts', ['a'], ['b']));
  it('weight 2 after a failed run, 1 otherwise', () => {
    const failed = testAndSource.run(t, action([t, s], { session: fakeView({ failed: true }) }), OPTS);
    expect(failed).toEqual([{ category: 'test_and_source', weight: 2, detail: 'changes tests and source code in one action, after a failed test run' }]);
    const passed = testAndSource.run(t, action([t, s], { session: fakeView() }), OPTS);
    expect(passed[0].weight).toBe(1);
    expect(passed[0].detail).toBe('changes tests and source code in one action');
  });
});

describe('test_and_source across actions (④)', () => {
  const src = change(update('src/math.js', ['a'], ['b']));
  const tst = change(update('src/math.test.js', ['a'], ['b']));
  const view = (recent: string[], failed = false): SessionView => ({ ...fakeView({ failed }), recentEdits: () => recent });
  it('source now, its test edited recently → finding; failed run → weight 2', () => {
    expect(testAndSource.run(src, action([src], { session: view(['src/math.test.js']) }), OPTS))
      .toEqual([{ category: 'test_and_source', weight: 1, detail: 'changes src/math.js and its test src/math.test.js within 10 minutes' }]);
    expect(testAndSource.run(src, action([src], { session: view(['src/math.test.js'], true) }), OPTS)[0])
      .toMatchObject({ weight: 2, detail: 'changes src/math.js and its test src/math.test.js within 10 minutes, after a failed test run' });
  });
  it('test now, its source edited recently → finding', () => {
    expect(ids(testAndSource.run(tst, action([tst], { session: view(['src/math.js']) }), OPTS))).toEqual(['test_and_source']);
  });
  it('unrelated recent edits → nothing', () => {
    expect(testAndSource.run(src, action([src], { session: view(['src/money.test.js', 'src/math.js']) }), OPTS)).toEqual([]);
  });
});
