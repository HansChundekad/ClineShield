import { CATEGORIES, PRESET_CUTOFFS } from '../categories';

describe('categories', () => {
  it('hard rules are the three spec hard rules', () => {
    const hard = Object.entries(CATEGORIES).filter(([, d]) => d.kind === 'hard').map(([id]) => id).sort();
    expect(hard).toEqual(['placeholder', 'secret_added', 'self_protection']);
  });
  it('every category has a fix sentence', () => {
    for (const d of Object.values(CATEGORIES)) expect(d.fix.length).toBeGreaterThan(10);
  });
  it('preset cut-offs match the spec', () => {
    expect(PRESET_CUTOFFS).toEqual({
      relaxed: { ask: 60, block: 90 }, balanced: { ask: 40, block: 70 }, strict: { ask: 25, block: 50 },
    });
  });
  it('rewrite_share top band is 50 so strict blocks a full rewrite', () => {
    expect(CATEGORIES.rewrite_share.max).toBe(50);
  });
});
