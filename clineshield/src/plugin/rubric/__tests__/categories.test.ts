import { CATEGORIES, PRESET_CUTOFFS } from '../categories';

describe('categories', () => {
  it('hard rules are the four spec hard rules', () => {
    const hard = Object.entries(CATEGORIES).filter(([, d]) => d.kind === 'hard').map(([id]) => id).sort();
    expect(hard).toEqual(['placeholder', 'rm_outside', 'secret_added', 'self_protection']);
  });
  it('every category has a fix sentence', () => {
    for (const d of Object.values(CATEGORIES)) expect(d.fix.length).toBeGreaterThan(10);
  });
  it('preset cut-offs match the spec', () => {
    expect(PRESET_CUTOFFS).toEqual({
      relaxed: { ask: 60, block: 90 }, balanced: { ask: 40, block: 70 }, strict: { ask: 25, block: 50 },
    });
  });
  it('every scored category has a risk group; hard and log-only have none', () => {
    for (const [id, d] of Object.entries(CATEGORIES)) {
      expect([id, d.group === null]).toEqual([id, d.kind === 'hard' || d.kind === 'logOnly']);
    }
    const lost = Object.entries(CATEGORIES).filter(([, d]) => d.group === 'lost_code').map(([id]) => id).sort();
    expect(lost).toEqual(['exports_removed', 'functions_removed', 'lines_removed', 'rewrite_share']);
  });
  it('rewrite_share top band is 50 so strict blocks a full rewrite', () => {
    expect(CATEGORIES.rewrite_share.max).toBe(50);
  });
});

describe('command categories', () => {
  it('points, kinds and groups match the spec table', () => {
    const view = (id: keyof typeof CATEGORIES) => [CATEGORIES[id].max, CATEGORIES[id].kind, CATEGORIES[id].group];
    expect(view('rm_recursive')).toEqual([20, 'critical', 'file_ops']);
    expect(view('shell_edit')).toEqual([15, 'signal', 'file_ops']);
    expect(view('unknown_target')).toEqual([40, 'critical', 'file_ops']);
    expect(view('discards_work')).toEqual([50, 'critical', 'unrecoverable']);
    expect(view('history_rewrite')).toEqual([50, 'critical', 'unrecoverable']);
    expect(view('sudo')).toEqual([40, 'critical', 'privilege']);
    expect(view('chmod_broad')).toEqual([30, 'signal', 'privilege']);
    expect(view('pipe_to_shell')).toEqual([45, 'critical', 'external']);
    expect(view('destructive_sql')).toEqual([50, 'critical', 'external']);
    expect(view('publish')).toEqual([60, 'critical', 'external']);
    expect(view('secret_exfil')).toEqual([70, 'critical', 'external']);
  });
});
