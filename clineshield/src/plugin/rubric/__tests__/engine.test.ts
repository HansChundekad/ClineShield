import { DEADLINE_MS, levelFor, scoreAction } from '../engine';
import { mergeConfigs, validateConfig } from '../../config/schema';
import { OPTS, action, change, update } from './fixtures';
import type { Check } from '../types';

const cfg = (raw: unknown = {}) => mergeConfigs(validateConfig(raw, 'personal').config, {});
const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const known = (file: string, removed: number, total: number) => {
  const c = change(update(file, lines(removed), ['x'], []), { original: lines(total).join('\n') + '\n' });
  c.matched = true;
  return c;
};

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
    const t = known('src/a.test.ts', 38, 40);
    expect(scoreAction(action([t]), cfg()).files[0].score).toBe(40);
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
