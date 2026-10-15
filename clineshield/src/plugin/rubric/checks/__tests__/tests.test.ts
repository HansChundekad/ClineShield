import { testAndSource, testsCheck } from '../tests';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (c: ReturnType<typeof change>) => testsCheck.run(c, action([c]), OPTS);

describe('testsCheck', () => {
  it.each([
    ['src/a.test.ts', "it.skip('works', () => {})"],
    ['src/a.test.ts', "xit('works', () => {})"],
    ['tests/test_a.py', '@pytest.mark.skip(reason="x")'],
    ['pkg/a_test.go', '\tt.Skip("later")'],
    ['src/test/FooTest.java', '@Disabled'],
    ['tests/a.rs', '#[ignore]'],
    ['spec/a_spec.rb', "xit 'works' do"],
  ])('tests_skipped in %s', (file, line) => {
    expect(ids(run(change(update(file, [], [line]))))).toContain('tests_skipped');
  });

  it.each([
    ['src/a.ts', '// eslint-disable-next-line'],
    ['src/a.ts', '// @ts-ignore'],
    ['a.py', 'x = f()  # type: ignore'],
    ['a.py', 'import os  # noqa'],
    ['a.go', 'x := 1 //nolint'],
    ['A.java', '@SuppressWarnings("unchecked")'],
    ['a.rs', '#[allow(dead_code)]'],
    ['a.rb', '# rubocop:disable Metrics/AbcSize'],
  ])('checks_disabled in %s', (file, line) => {
    expect(ids(run(change(update(file, [], [line]))))).toContain('checks_disabled');
  });

  it('tests_deleted: test file deleted or test cases removed', () => {
    expect(ids(run(change(['*** Delete File: src/a.test.ts'])))).toContain('tests_deleted');
    expect(ids(run(change(update('src/a.test.ts', ["it('a', () => {", 'expect(1).toBe(1);', '});'], []))))).toContain('tests_deleted');
    expect(ids(run(change(update('tests/test_a.py', ['def test_a():', '    assert f() == 1'], []))))).toContain('tests_deleted');
  });

  it('assertions_weakened: removed or strong → weak', () => {
    expect(ids(run(change(update('src/a.test.ts', ['expect(f()).toBe(3);'], []))))).toContain('assertions_weakened');
    expect(ids(run(change(update('src/a.test.ts', ['expect(f()).toEqual({a: 1});'], ['expect(f()).toBeDefined();']))))).toContain('assertions_weakened');
    expect(ids(run(change(update('tests/test_a.py', ['self.assertEqual(f(), 3)'], ['self.assertTrue(f())']))))).toContain('assertions_weakened');
  });

  it('expected_changed: same assertion, different literal', () => {
    expect(ids(run(change(update('src/a.test.ts', ['expect(sum(1, 2)).toBe(3);'], ['expect(sum(1, 2)).toBe(4);']))))).toEqual(['expected_changed']);
  });

  it('adding a new assertion or test is fine', () => {
    expect(run(change(update('src/a.test.ts', [], ["it('b', () => {", 'expect(2).toBe(2);', '});'])))).toEqual([]);
  });

  it('assertion rules only apply to test files', () => {
    expect(run(change(update('src/a.ts', ['assert(x);'], [])))).toEqual([]);
  });
});

describe('testAndSource', () => {
  it('fires when one action changes tests and source', () => {
    const t = change(update('src/a.test.ts', ['a'], ['b']));
    const s = change(update('src/a.ts', ['a'], ['b']));
    expect(ids(testAndSource.run(t, action([t, s]), OPTS))).toEqual(['test_and_source']);
    expect(testAndSource.run(t, action([t]), OPTS)).toEqual([]);
  });
});
