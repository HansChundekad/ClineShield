import { EDIT_WINDOW_MS, MAX_EDITS_PER_FILE, MAX_FILES, SessionStore, isTestRun, readPaths, testOutcome } from '../session';

describe('SessionStore', () => {
  let t = 0;
  const now = () => t;
  beforeEach(() => { t = 1_000_000; });

  it('outcome failed → passed clears; undefined keeps', () => {
    const s = new SessionStore(now);
    expect(s.view().lastTestFailed).toBe(false);
    s.recordTestOutcome('failed');
    expect(s.view().lastTestFailed).toBe(true);
    s.recordTestOutcome(undefined);
    expect(s.view().lastTestFailed).toBe(true);
    s.recordTestOutcome('passed');
    expect(s.view().lastTestFailed).toBe(false);
  });

  it('recordEdit marks known and adds churn', () => {
    const s = new SessionStore(now);
    expect(s.view().known('a.ts')).toBe(false);
    s.recordEdit('a.ts', 7);
    s.recordEdit('b.ts', 5);
    expect(s.view().known('a.ts')).toBe(true);
    expect(s.view().churn).toBe(12);
    expect(s.view().priorEdits('a.ts')).toBe(1);
  });

  it('recordRead marks known without an edit', () => {
    const s = new SessionStore(now);
    s.recordRead('a.ts');
    expect(s.view().known('a.ts')).toBe(true);
    expect(s.view().priorEdits('a.ts')).toBe(0);
  });

  it('priorEdits counts only the last 10 minutes', () => {
    const s = new SessionStore(now);
    const start = t;
    s.recordEdit('a.ts', 1);
    t = start + 60_000;
    s.recordEdit('a.ts', 1);
    t = start + EDIT_WINDOW_MS;
    expect(s.view().priorEdits('a.ts')).toBe(2);
    t = start + EDIT_WINDOW_MS + 1;
    expect(s.view().priorEdits('a.ts')).toBe(1);
  });

  it('keeps at most 20 timestamps per file', () => {
    const s = new SessionStore(now);
    for (let i = 0; i < MAX_EDITS_PER_FILE + 1; i++) s.recordEdit('a.ts', 1);
    expect(s.view().priorEdits('a.ts')).toBe(MAX_EDITS_PER_FILE);
  });

  it('the 501st file evicts the least recently touched; touching keeps it', () => {
    const s = new SessionStore(now);
    for (let i = 0; i < MAX_FILES; i++) s.recordRead(`f${i}`);
    s.recordRead('f0');
    s.recordRead('new');
    expect(s.size).toBe(MAX_FILES);
    expect(s.view().known('f0')).toBe(true);
    expect(s.view().known('f1')).toBe(false);
    expect(s.view().known('new')).toBe(true);
  });

  it('delete forgets; move marks the target known and drops the source', () => {
    const s = new SessionStore(now);
    s.recordEdit('a.ts', 1);
    s.recordDelete('a.ts');
    expect(s.view().known('a.ts')).toBe(false);
    s.recordEdit('b.ts', 1);
    s.recordMove('b.ts', 'c.ts');
    expect(s.view().known('b.ts')).toBe(false);
    expect(s.view().known('c.ts')).toBe(true);
    expect(s.view().priorEdits('c.ts')).toBe(0);
  });

  it('the view is live', () => {
    const s = new SessionStore(now);
    const v = s.view();
    s.recordTestOutcome('failed');
    s.recordEdit('a.ts', 3);
    expect(v.lastTestFailed).toBe(true);
    expect(v.churn).toBe(3);
  });
});

const ENV = { cwd: '/ws', home: '/home/u', tmpdir: '/tmp' };
const sh = (shell: string) => ({ shell });

describe('isTestRun', () => {
  it.each([
    'npm test', 'pnpm test', 'yarn test', 'bun test', 'npm run test', 'npm run test:unit', 'yarn run test',
    'npx jest', 'npx vitest run', 'pnpm exec vitest', 'yarn jest', 'bunx mocha', 'jest', 'vitest', 'mocha',
    'pytest -q', 'rspec', 'python -m pytest', 'python3 -m unittest', 'go test ./...', 'cargo test', 'dotnet test',
    'mvn test', 'gradle test', './gradlew test', 'make test',
    'cd app && npm test', 'cd a; cd b && pytest', 'env CI=1 npm test', 'timeout 60 npx jest', 'CI=1 npm test',
  ])('%s is a test run', cmd => expect(isTestRun(sh(cmd), ENV)).toBe(true));

  it.each([
    'npm run build && npm test', 'npm test | tail -20', 'npm test || true', 'npm test; echo done', 'npm install',
    'echo test', 'npm test "', 'bash -c "npm test"', 'npm run testing', 'go build', 'git status', '',
  ])('%s is not a test run', cmd => expect(isTestRun(sh(cmd), ENV)).toBe(false));

  it('argv entries count too', () => {
    expect(isTestRun({ argv: ['npm', 'test'] }, ENV)).toBe(true);
    expect(isTestRun({ argv: ['npm', 'install'] }, ENV)).toBe(false);
  });
});

describe('testOutcome', () => {
  const failed = { query: 'npm test', result: 'x', error: 'Command exited with code 1', success: false };
  const passed = { query: 'npm test', result: 'ok', success: true };
  const out = (...o: unknown[]) => ({ output: o, isError: false });

  it('exit code non-zero → failed; success → passed', () => {
    expect(testOutcome({ commands: ['npm test'] }, out(failed), ENV)).toBe('failed');
    expect(testOutcome({ commands: ['npm test'] }, out(passed), ENV)).toBe('passed');
  });
  it.each(['Command timed out after 1ms', 'Command terminated by signal SIGTERM', 'Command failed: spawn ENOENT', 'Command exited with code 0'])(
    '%s → unknown', error => expect(testOutcome({ commands: ['npm test'] }, out({ ...failed, error }), ENV)).toBeUndefined());
  it('whole-tool error or odd output → unknown', () => {
    expect(testOutcome({ commands: ['npm test'] }, { output: [failed], isError: true }, ENV)).toBeUndefined();
    expect(testOutcome({ commands: ['npm test'] }, { output: { error: 'skipped' }, isError: true }, ENV)).toBeUndefined();
    expect(testOutcome({ commands: ['npm test'] }, { output: 'x' }, ENV)).toBeUndefined();
    expect(testOutcome({ commands: ['npm test'] }, undefined, ENV)).toBeUndefined();
    expect(testOutcome(42, out(failed), ENV)).toBeUndefined();
  });
  it('several test entries: any failed → failed', () => {
    expect(testOutcome({ commands: ['npm test', 'pytest'] }, out(passed, failed), ENV)).toBe('failed');
    expect(testOutcome({ commands: ['npm test', 'pytest'] }, out(passed, passed), ENV)).toBe('passed');
  });
  describe('test then echo of $? (the printed number decides)', () => {
    const cmd = 'cd /ws && npm test 2>&1; echo "EXIT_CODE=$?"';
    const res = (result: string) => out({ query: cmd, result, success: true });
    it('non-zero → failed; 0 → passed', () => {
      expect(testOutcome({ commands: [cmd] }, res('> test\nAssertionError\nEXIT_CODE=1\n'), ENV)).toBe('failed');
      expect(testOutcome({ commands: [cmd] }, res('> test\n\nEXIT_CODE=0\n'), ENV)).toBe('passed');
    });
    it.each([
      ['npm test; echo $?', '3'], ['npm test; echo "exit: $?"', 'exit: 3'], ['pytest -q; echo "[rc=$?]"', '[rc=3]'],
      ['npm test && echo "rc=$?"', 'rc=3'], ['npm test || echo "rc=$?"', 'rc=3'], ['npm test; echo -e "rc=$?"', 'rc=3'],
    ])('%s printing %s → failed', (c, line) => expect(testOutcome({ commands: [c] }, res(`x\n${line}`), ENV)).toBe('failed'));
    it.each([
      ['number missing or line changed', 'npm test; echo "EXIT_CODE=$?"', 'EXIT_CODE=\n'],
      ['not the last line', 'npm test; echo "EXIT_CODE=$?"', 'EXIT_CODE=1\nmore'],
      ['truncated output', 'npm test; echo "EXIT_CODE=$?"', 'Assertion'],
      ['other variable in the echo', 'npm test; echo "$X=$?"', 'a=1'],
      ['no $? in the echo', 'npm test; echo done', 'done'],
      ['single-quoted $? is literal', "npm test; echo 'rc=$?'", 'rc=$?'],
      ['two $?', 'npm test; echo "$? $?"', '1 1'],
      ['echo before the test', 'echo "rc=$?"; npm test', 'rc=1'],
      ['piped echo', 'npm test | echo "rc=$?"', 'rc=1'],
      ['something else after', 'npm test; echo "rc=$?"; ls', 'rc=1'],
    ])('%s → unknown', (_n, c, result) => expect(testOutcome({ commands: [c] }, res(result), ENV)).toBeUndefined());
    it('a failed entry exit still says failed when the echo is skipped (&&)', () =>
      expect(testOutcome({ commands: ['npm test && echo "rc=$?"'] }, out(failed), ENV)).toBe('failed'));
  });
  it('non-test entries are ignored', () => {
    expect(testOutcome({ commands: ['npm run build'] }, out(failed), ENV)).toBeUndefined();
    expect(testOutcome({ commands: ['npm run build', 'npm test'] }, out(failed, passed), ENV)).toBe('passed');
    expect(testOutcome('npm test | tail', out(failed), ENV)).toBeUndefined();
  });
});

describe('readPaths', () => {
  const ok = { success: true }, bad = { success: false };
  const out = (...o: unknown[]) => ({ output: o, isError: false });
  it('keeps successful entries, whole or ranged', () => {
    expect(readPaths({ files: [{ path: '/ws/a.ts' }, { path: '/ws/b.ts', start_line: 1, end_line: 5 }] }, out(ok, bad))).toEqual(['/ws/a.ts']);
    expect(readPaths({ files: [{ path: '/ws/a.ts' }, { path: '/ws/b.ts', start_line: 1, end_line: 5 }] }, out(ok, ok))).toEqual(['/ws/a.ts', '/ws/b.ts']);
  });
  it('readPaths legacy shapes', () => {
    for (const input of ['x.ts', ['x.ts'], [{ path: 'x.ts' }], { paths: ['x.ts'] }, { paths: 'x.ts' }, { file_paths: ['x.ts'] },
      { file_paths: 'x.ts' }, { files: 'x.ts' }, { files: { path: 'x.ts' } }, { file_path: 'x.ts' }, { filePath: 'x.ts' }, { path: 'x.ts' }]) {
      expect([input, readPaths(input, out(ok))]).toEqual([input, ['x.ts']]);
    }
  });
  it('whole-tool error or odd output → nothing', () => {
    expect(readPaths({ files: [{ path: 'a' }] }, { output: [ok], isError: true })).toEqual([]);
    expect(readPaths({ files: [{ path: 'a' }] }, { output: 'x' })).toEqual([]);
    expect(readPaths(null, out(ok))).toEqual([]);
    expect(readPaths({ files: [{ nope: 1 }] }, out(ok))).toEqual([]);
  });
});

describe('recentEdits and pending edits', () => {
  let t = 0;
  const now = () => t;
  it('lists edits in the window plus approved edits still running', () => {
    t = 1_000_000;
    const s = new SessionStore(now);
    s.recordEdit('old.ts', 1);
    t += EDIT_WINDOW_MS + 1;
    s.recordEdit('a.ts', 1);
    s.recordRead('r.ts');
    s.recordPending('c1', ['b.test.ts']);
    expect(s.view().recentEdits().sort()).toEqual(['a.ts', 'b.test.ts']);
    s.clearPending('c1');
    expect(s.view().recentEdits()).toEqual(['a.ts']);
  });
  it('pending edits are bounded', () => {
    const s = new SessionStore(now);
    for (let i = 0; i < 100; i++) s.recordPending(`c${i}`, [`f${i}`]);
    expect(s.view().recentEdits().length).toBeLessThanOrEqual(50);
  });
});

import { shellReadPaths } from '../session';
describe('shellReadPaths', () => {
  const ok = (n = 1) => ({ output: Array.from({ length: n }, () => ({ success: true })) });
  it('cat / head / tail / less of literal files in successful entries', () => {
    expect(shellReadPaths({ commands: ["cd /ws/app && ls -la && cat a.js && echo '---' && cat b.js 2>/dev/null || true"] }, ok(), ENV))
      .toEqual(['/ws/app/a.js', '/ws/app/b.js']);
    expect(shellReadPaths({ commands: ['head -n 5 x.ts', 'tail -20 /abs/y.ts', 'less z.md'] }, ok(3), ENV)).toEqual(['/ws/x.ts', '/abs/y.ts', '/ws/z.md']);
  });
  it('failed entries, dynamic names and errors record nothing', () => {
    expect(shellReadPaths({ commands: ['cat a.js'] }, { output: [{ success: false, error: 'Command exited with code 1' }] }, ENV)).toEqual([]);
    expect(shellReadPaths({ commands: ['cat $F'] }, ok(), ENV)).toEqual([]);
    expect(shellReadPaths({ commands: ['cat a.js'] }, { output: [{ success: true }], isError: true }, ENV)).toEqual([]);
    expect(shellReadPaths({ commands: ['cat "unclosed'] }, ok(), ENV)).toEqual([]);
    expect(shellReadPaths({ commands: ['grep x a.js'] }, ok(), ENV)).toEqual([]);
  });
});
