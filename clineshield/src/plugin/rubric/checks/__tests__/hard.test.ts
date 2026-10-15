import { placeholder, secretAdded, selfProtection } from '../hard';
import { HOME, OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (check: typeof placeholder, c: ReturnType<typeof change>) => check.run(c, action([c]), OPTS);

describe('self_protection', () => {
  it.each([
    '.cline-shield.yml', '.cline-shield/metrics.json', '.cline/plugins/x/index.ts',
  ])('fires for %s', file => {
    expect(ids(run(selfProtection, change(update(file, ['a'], ['b']))))).toEqual(['self_protection']);
  });
  it('fires for the personal config and the plugin dir', () => {
    expect(ids(run(selfProtection, change(update(`${HOME}/.cline-shield.yml`, ['a'], ['b']))))).toEqual(['self_protection']);
    expect(ids(run(selfProtection, change(update('/plugins/clineshield/src/a.ts', ['a'], ['b']))))).toEqual(['self_protection']);
  });
  it('fires when a move targets a protected file', () => {
    const c = change(['*** Update File: x.yml', '*** Move to: .cline-shield.yml', '@@', '-a', '+b']);
    expect(ids(run(selfProtection, c))).toEqual(['self_protection']);
  });
  it('still fires when the host reports roots with a trailing slash', () => {
    const c = change(update('.cline-shield.yml', ['a'], ['b']));
    const p = change(update(`${HOME}/.cline-shield.yml`, ['a'], ['b']));
    const a = action([c], { workspaceRoot: '/ws/', homeDir: `${HOME}/` });
    expect(ids(selfProtection.run(c, a, OPTS))).toEqual(['self_protection']);
    expect(ids(selfProtection.run(p, a, OPTS))).toEqual(['self_protection']);
  });
  it('ignores ordinary files and the example config', () => {
    expect(run(selfProtection, change(update('src/a.ts', ['a'], ['b'])))).toEqual([]);
    expect(run(selfProtection, change(update('.cline-shield.example.yml', ['a'], ['b'])))).toEqual([]);
  });
});

describe('placeholder', () => {
  it.each([
    '// ... rest of code unchanged',
    '# ... existing code here',
    '/* rest of the file remains the same */',
    '// existing implementation unchanged',
    '// ...',
    '    // ... other methods',
  ])('blocks "%s" in an edit to an existing file', line => {
    expect(ids(run(placeholder, change(update('src/a.ts', ['real()'], [line]))))).toEqual(['placeholder']);
  });

  it('blocks a stub that replaces a real body', () => {
    const c = change(update('src/a.py', ['x = load()', 'y = parse(x)', 'return y'], ['raise NotImplementedError']));
    expect(ids(run(placeholder, c))).toEqual(['placeholder']);
    const js = change(update('src/a.ts', ['const a = 1;', 'const b = 2;', 'return a + b;'], ['// TODO: implement']));
    expect(ids(run(placeholder, js))).toEqual(['placeholder']);
  });

  it('does not fire in new files (scaffolding)', () => {
    expect(run(placeholder, change(['*** Add File: src/new.ts', '+// TODO: implement', '+export {}']))).toEqual([]);
  });

  it('does not fire when a stub replaces fewer than 3 real lines or only adds pass to an empty body', () => {
    expect(run(placeholder, change(update('src/a.py', ['x = 1'], ['pass'])))).toEqual([]);
    expect(run(placeholder, change(update('src/a.py', [], ['    pass'], ['def f():'])))).toEqual([]);
  });

  it('does not fire on ordinary comments or spread syntax', () => {
    expect(run(placeholder, change(update('src/a.ts', ['a'], ['// rest api client', 'const x = [...rest];'])))).toEqual([]);
  });
});

describe('secret_added', () => {
  it.each([
    'const k = "AKIAABCDEFGHIJKLMNOP";',
    'token = "ghp_' + 'a'.repeat(36) + '"',
    'STRIPE = "sk_live_' + 'a1'.repeat(12) + '"',
    '-----BEGIN RSA PRIVATE KEY-----',
    'api_key: "a1b2c3d4e5f6g7h8i9j0k1l2"',
  ])('blocks %s', line => {
    expect(ids(run(secretAdded, change(update('src/a.ts', [], [line]))))).toEqual(['secret_added']);
  });
  it('ignores AWS example keys, placeholders and .env files', () => {
    expect(run(secretAdded, change(update('src/a.ts', [], ['k = "AKIAIOSFODNN7EXAMPLE"'])))).toEqual([]);
    expect(run(secretAdded, change(update('src/a.ts', [], ['api_key: "your-api-key-here"'])))).toEqual([]);
    expect(run(secretAdded, change(update('.env', [], ['API_KEY=AKIAABCDEFGHIJKLMNOP'])))).toEqual([]);
  });
  it('only looks at added lines', () => {
    expect(run(secretAdded, change(update('src/a.ts', ['k = "AKIAABCDEFGHIJKLMNOP"'], [])))).toEqual([]);
  });
});
