import { DEADLINE_MS, levelFor, scoreAction } from '../engine';
import { validateConfig, withDefaults } from '../../config/schema';
import { KEPT_HEAD, OPTS, PRODUCT_LINES, PRODUCT_REWRITE, PRODUCT_TEXT, action, change, update } from './fixtures';
import type { Check } from '../types';

const cfg = (raw: unknown = {}) => withDefaults(validateConfig(raw).config);
const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const known = (file: string, removed: number, total: number) => {
  const c = change(update(file, lines(removed), ['x'], []), { original: lines(total).join('\n') + '\n' });
  c.matched = true;
  return c;
};

const productRewrite = (file: string) => {
  const c = change(update(file, PRODUCT_LINES.slice(KEPT_HEAD), PRODUCT_REWRITE, []), { original: PRODUCT_TEXT });
  c.matched = true;
  return c;
};
const pts = (d: ReturnType<typeof scoreAction>, id: string) => d.files[0].findings.filter(f => f.id === id).reduce((s, f) => s + f.points, 0);

/** Case 4: 64% rewrite of a 100-line file removing 6 exported + 1 private function. */
const wideRewrite = (file: string) => {
  const fns = [...['a', 'b', 'c', 'd', 'e', 'f'].map(n => `export function ${n}() {`), 'function g() {'].flatMap(h => [h, '  return 1;', '}']);
  const rest = lines(100 - fns.length);
  const c = change(update(file, [...fns, ...rest.slice(0, 43)], ['x'], []), { original: [...fns, ...rest].join('\n') + '\n' });
  c.matched = true;
  return c;
};
const ciEdit = () => change(update('.github/workflows/ci.yml', ['a'], ['b']));

describe('risk groups: each kind of risk counts once per file', () => {
  it('lost code: only the biggest of rewrite_share, functions_removed, exports_removed counts', () => {
    const d = scoreAction(action([productRewrite('src/models/product.ts')]), cfg());
    const f = d.files[0];
    expect(f.findings.map(x => x.id)).toEqual(expect.arrayContaining(['rewrite_share', 'functions_removed', 'exports_removed']));
    expect(pts(d, 'rewrite_share')).toBe(50);
    expect(pts(d, 'functions_removed')).toBe(0);
    expect(pts(d, 'exports_removed')).toBe(0);
    expect(f.findings.find(x => x.id === 'functions_removed')!.detail).toMatch(/\(counted in rewrite_share\)$/);
    expect(f.findings.find(x => x.id === 'exports_removed')!.detail).toMatch(/\(counted in rewrite_share\)$/);
    expect(f.findings.find(x => x.id === 'rewrite_share')!.detail).not.toMatch(/counted in/);
  });

  it('when structure is bigger it wins and rewrite share is noted', () => {
    const d = scoreAction(action([productRewrite('src/models/product.ts')]), cfg({ categories: { rewrite_share: 20 } }));
    expect(d.files[0].score).toBe(40);
    expect(pts(d, 'functions_removed')).toBe(40);
    expect(d.files[0].findings.find(x => x.id === 'rewrite_share')!.detail).toMatch(/\(counted in functions_removed\)$/);
  });

  it('event counts are unchanged', () => {
    const f = scoreAction(action([productRewrite('src/models/product.ts')]), cfg()).files[0];
    expect(f.functionsDeleted).toBeGreaterThan(0);
    expect(f.exportsDeleted).toBe(1);
    expect(f.structuralChangePercent).toBeGreaterThanOrEqual(75);
  });

  it('small edit deleting 4 functions in a big file → functions_removed 40, ask', () => {
    const fns = ['a', 'b', 'c', 'd'].flatMap(n => [`function ${n}() {`, '  return 1;', '}']);
    const c = change(update('lib/big.ts', fns, ['// gone'], []), { original: [...fns, ...lines(1000)].join('\n') + '\n' });
    c.matched = true;
    const d = scoreAction(action([c]), cfg());
    expect(pts(d, 'functions_removed')).toBe(40);
    expect(d.files[0].score).toBe(40);
    expect(d.tier).toBe('ask');
  });

  it('rewrite share 50% band (25) + 3 functions removed (30) scores 30, not 55', () => {
    const fns = ['a', 'b', 'c'].flatMap(n => [`function ${n}() {`, '  return 1;', '}']);
    const rest = lines(100 - fns.length);
    const original = [...fns, ...rest];
    const c = change(update('lib/mid.ts', [...fns, ...rest.slice(0, 41)], ['x'], []), { original: original.join('\n') + '\n' });
    c.matched = true;
    const d = scoreAction(action([c]), cfg());
    expect(pts(d, 'rewrite_share') + pts(d, 'functions_removed')).toBe(30);
    expect(d.files[0].score).toBe(30);
  });

  it('weakening group counts once, including the per-action test_and_source', () => {
    const t = change(update('src/a.test.ts', ['expect(x).toBe(1);'], ["it.skip('x', () => {})", 'expect(x).toBeDefined();']));
    const s = change(update('src/a.ts', ['a'], ['b']));
    const d = scoreAction(action([t, s]), cfg());
    const f = d.files.find(x => x.file === 'src/a.test.ts')!;
    expect(f.findings.map(x => x.id)).toEqual(expect.arrayContaining(['tests_skipped', 'assertions_weakened', 'test_and_source']));
    expect(f.score).toBe(30);
    expect(f.findings.filter(x => x.points > 0)).toHaveLength(1);
  });

  it('custom rules share one group', () => {
    const c = change(update('billing/pay.ts', [], ['legacyCharge()']));
    const d = scoreAction(action([c]), cfg({ custom_rules: [
      { match: 'path', pattern: 'billing/**', points: 30, message: 'Billing code' },
      { match: 'content', pattern: 'legacyCharge', points: 25, message: 'Use charge()' },
    ] }));
    expect(d.files[0].score).toBe(30);
    expect(d.files[0].findings.find(x => x.id === 'custom:1')!.detail).toMatch(/\(counted in custom:0\)$/);
  });

  it('test-file discount applies only to size points that counted', () => {
    // rewrite_share (50, counted) on a test file: 50 - 10.
    expect(scoreAction(action([known('src/a.test.ts', 38, 40)]), cfg()).files[0].score).toBe(40);
    // lines_removed loses to functions_removed: no discount.
    const fns = ['a', 'b', 'c', 'd'].flatMap(n => [`function ${n}() {`, '  return 1;', '}']);
    const removed = [...fns, ...lines(100)];
    const c = change(update('lib/big.test.ts', removed, ['x'], []), { original: [...removed, ...lines(1000, 'k')].join('\n') + '\n' });
    c.matched = true;
    const d = scoreAction(action([c]), cfg());
    expect(pts(d, 'lines_removed')).toBe(0);
    expect(d.files[0].score).toBe(40);
  });
});

describe('blocking needs two kinds of risk (relaxed, balanced)', () => {
  it('1: full rewrite of a class file → 50, ask', () => {
    const d = scoreAction(action([productRewrite('src/models/product.ts')]), cfg());
    expect(d.files[0].score).toBe(50);
    expect(d.tier).toBe('ask');
  });

  it('2: same file with uncommitted changes → 80 (2 groups), block', () => {
    const c = productRewrite('src/models/product.ts');
    c.gitDirty = true;
    const d = scoreAction(action([c]), cfg());
    expect(d.files[0].score).toBe(80);
    expect(d.tier).toBe('block');
  });

  it('3: same file under src/auth/ → 80 (2 groups), block', () => {
    const d = scoreAction(action([productRewrite('src/auth/product.ts')]), cfg());
    expect(d.files[0].score).toBe(80);
    expect(d.tier).toBe('block');
  });

  it('4: 64% rewrite, 7 functions, 6 exports removed → 40, ask', () => {
    const d = scoreAction(action([wideRewrite('lib/wide.ts')]), cfg());
    expect(d.files[0].functionsDeleted).toBe(7);
    expect(d.files[0].exportsDeleted).toBe(6);
    expect(d.files[0].structuralChangePercent).toBe(64);
    expect(d.files[0].score).toBe(40);
    expect(d.tier).toBe('ask');
  });

  it('8: one group above the block cut-off → ask under balanced, block under strict', () => {
    const d = scoreAction(action([ciEdit()]), cfg({ categories: { ci_config: 80 } }));
    expect(d.files[0].score).toBe(80);
    expect(d.tier).toBe('ask');
    expect(d.files[0].level).toBe('high');
    expect(scoreAction(action([ciEdit()]), cfg({ preset: 'strict', categories: { ci_config: 80 } })).tier).toBe('block');
  });

  it('9: case 1 under strict → 50, block', () => {
    const d = scoreAction(action([productRewrite('src/models/product.ts')]), cfg({ preset: 'strict' }));
    expect(d.files[0].score).toBe(50);
    expect(d.tier).toBe('block');
  });

  it('10: case 2 under relaxed → 80, ask', () => {
    const c = productRewrite('src/models/product.ts');
    c.gitDirty = true;
    const d = scoreAction(action([c]), cfg({ preset: 'relaxed' }));
    expect(d.files[0].score).toBe(80);
    expect(d.tier).toBe('ask');
  });

  it('relaxed: two groups at or above 90 → block', () => {
    const d = scoreAction(action([productRewrite('src/auth/product.ts')]), cfg({ preset: 'relaxed', categories: { protected_path: 40 } }));
    expect(d.files[0].score).toBe(90);
    expect(d.tier).toBe('block');
  });

  it('11: a hard rule blocks in every preset', () => {
    for (const preset of ['relaxed', 'balanced', 'strict']) {
      const c = change(update('lib/a.ts', ['real()'], ['// ... rest of code unchanged']));
      expect(scoreAction(action([c]), cfg({ preset })).tier).toBe('block');
    }
  });

  it('12: a per-folder strict preset decides for files under it', () => {
    const d = scoreAction(action([productRewrite('lib/product.ts')]), cfg({ paths: { 'lib/**': { preset: 'strict' } } }));
    expect(d.files[0].score).toBe(50);
    expect(d.tier).toBe('block');
  });

  it('a category set to block still blocks', () => {
    const d = scoreAction(action([productRewrite('src/models/product.ts')]), cfg({ categories: { rewrite_share: 'block' } }));
    expect(d.tier).toBe('block');
  });
});

describe('scoreAction', () => {
  it('small edit to a big file → allow, low', () => {
    const d = scoreAction(action([known('src/a.ts', 2, 2000)]), cfg());
    expect(d.tier).toBe('allow');
    expect(d.files[0].level).toBe('low');
  });

  it('full rewrite of an ordinary file: asked under balanced, blocked under strict', () => {
    expect(scoreAction(action([known('lib/a.ts', 38, 40)]), cfg()).tier).toBe('ask');
    expect(scoreAction(action([known('lib/a.ts', 38, 40)]), cfg({ preset: 'strict' })).tier).toBe('block');
  });

  it('rewrite of a protected file → block (50 + 30)', () => {
    expect(scoreAction(action([known('src/auth/a.ts', 38, 40)]), cfg()).tier).toBe('block');
  });

  it('delete with uncommitted changes → ask (35 + 30 = 65)', () => {
    const d = scoreAction(action([change(['*** Delete File: lib/a.ts'], { gitDirty: true })]), cfg());
    expect(d.tier).toBe('ask');
    expect(d.files[0].score).toBe(65);
  });

  it('hard rule on one file blocks a multi-file action', () => {
    const ok = change(update('lib/b.ts', ['a'], ['b']));
    const bad = change(update('lib/a.ts', ['real()'], ['// ... rest of code unchanged']));
    const d = scoreAction(action([ok, bad]), cfg());
    expect(d.tier).toBe('block');
    expect(d.files.map(f => f.tier)).toEqual(['allow', 'block']);
  });

  it('test-file discount reduces size points only', () => {
    const skip = change(update('src/a.test.ts', [], ["it.skip('x', () => {})"]));
    expect(scoreAction(action([skip]), cfg()).files[0].score).toBe(30);
  });

  it('config: off, block, points and per-folder preset', () => {
    const c = change(update('lib/a.ts', [], ['// eslint-disable-next-line']));
    expect(scoreAction(action([c]), cfg({ categories: { checks_disabled: 'off' } })).files[0].findings).toEqual([]);
    expect(scoreAction(action([c]), cfg({ categories: { checks_disabled: 'block' } })).tier).toBe('block');
    expect(scoreAction(action([c]), cfg({ categories: { checks_disabled: 45 } })).tier).toBe('ask');
    expect(scoreAction(action([c]), cfg({ paths: { 'lib/**': { cutoffs: { ask: 10, block: 90 } } } })).tier).toBe('ask');
  });

  it('log-only findings are recorded with 0 points', () => {
    const c = change(update('lib/a.ts', ['const u = process.env.A;'], ['const u = process.env.B;']));
    const f = scoreAction(action([c]), cfg()).files[0];
    expect(f.findings).toEqual([expect.objectContaining({ id: 'env_key_renamed', points: 0, logOnly: true })]);
    expect(f.score).toBe(0);
  });

  it('custom rules: path and content', () => {
    const c = change(update('billing/pay.ts', [], ['legacyCharge()']));
    const d = scoreAction(action([c]), cfg({ custom_rules: [
      { match: 'path', pattern: 'billing/**', points: 40, message: 'Billing code: ask first' },
      { match: 'content', pattern: 'legacyCharge', points: 'block', message: 'Use charge() instead' },
    ] }));
    expect(d.tier).toBe('block');
    expect(d.files[0].findings.map(f => f.id)).toEqual(['custom:0', 'custom:1']);
  });

  it('custom content rules test only the first 500 chars of a line', () => {
    const long = '1'.repeat(50_000);
    const rules = cfg({ custom_rules: [{ match: 'content', pattern: '\\d+x', points: 10, message: 'm' }] });
    const start = Date.now();
    const d = scoreAction(action([change(update('lib/a.ts', [], [long]))]), rules);
    expect(Date.now() - start).toBeLessThan(200);
    expect(d.files[0].findings.some(f => f.id === 'custom:0')).toBe(false);
    const hit = scoreAction(action([change(update('lib/a.ts', [], ['12x' + long]))]), rules);
    expect(hit.files[0].findings.some(f => f.id === 'custom:0')).toBe(true);
  });

  it('files_touched is added to the worst file once', () => {
    const cs = lines(6).map(n => change(update(`lib/${n}.ts`, ['a'], ['b'])));
    const d = scoreAction(action(cs), cfg());
    expect(d.files.filter(f => f.findings.some(x => x.id === 'files_touched'))).toHaveLength(1);
  });

  it('a crashing signal check is skipped; a crashing critical check sets errored → ask', () => {
    const boom = (kind: 'critical' | 'signal'): Check => ({ name: `boom-${kind}`, kind, run: () => { throw new Error('x'); } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const c = change(update('lib/a.ts', ['a'], ['b']));
    const s = scoreAction(action([c]), cfg(), { checks: [boom('signal')] });
    expect(s).toMatchObject({ tier: 'allow', errored: false });
    expect(s.files[0].skipped).toEqual(['boom-signal: crashed']);
    const k = scoreAction(action([c]), cfg(), { checks: [boom('critical')] });
    expect(k).toMatchObject({ tier: 'ask', errored: true });
    expect(scoreAction(action([c]), cfg({ on_error: 'allow' }), { checks: [boom('critical')] }).tier).toBe('allow');
  });

  it('past the deadline, signal checks are skipped but critical checks still run', () => {
    let t = 0;
    const d = scoreAction(action([change(['*** Delete File: lib/a.test.ts'])]), cfg(), { now: () => (t += DEADLINE_MS) });
    expect(d.files[0].findings.map(f => f.id)).toContain('file_deleted');
    expect(d.files[0].skipped.some(s => s.endsWith('skipped (time)'))).toBe(true);
  });

  it('event numbers: structural percent, functions and exports deleted', () => {
    const c = known('lib/a.ts', 30, 40);
    c.removed = ['export function a() {}', 'function b() {}', ...lines(28)];
    c.hunks = [{ removed: c.removed, added: ['x'] }];
    const f = scoreAction(action([c]), cfg()).files[0];
    expect(f).toMatchObject({ structuralChangePercent: 75, functionsDeleted: 2, exportsDeleted: 1 });
  });
});

describe('levelFor', () => {
  it('maps score to level by cut-offs', () => {
    const c = { ask: 40, block: 70 };
    expect([levelFor(10, c), levelFor(40, c), levelFor(70, c)]).toEqual(['low', 'medium', 'high']);
  });
});

void OPTS;
