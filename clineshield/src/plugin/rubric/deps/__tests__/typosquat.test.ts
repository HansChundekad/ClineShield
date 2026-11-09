import { closestPopular, loadTopLists, makeLists } from '../typosquat';
import type { DepRef } from '../extract';

const npm = (name: string): DepRef => ({ ecosystem: 'npm', name });
const lists = makeLists(['express', 'lodash', 'react', 'typescript', 'zod'], ['requests', 'numpy']);

describe('closestPopular', () => {
  it('finds near names', () => {
    expect(closestPopular(npm('expresss'), lists)).toBe('express');
    expect(closestPopular({ ecosystem: 'pypi', name: 'reqeusts' }, lists)).toBe('requests');
    expect(closestPopular(npm('typescirpt'), lists)).toBe('typescript');
  });
  it('counts a swap of neighbours as one edit', () => {
    expect(closestPopular(npm('exrpess'), lists)).toBe('express');
  });
  it('never fires for a listed name, a scoped name, or the other ecosystem', () => {
    expect(closestPopular(npm('express'), lists)).toBeUndefined();
    expect(closestPopular(npm('EXPRESS'), lists)).toBeUndefined();
    expect(closestPopular(npm('@acme/express'), lists)).toBeUndefined();
    expect(closestPopular({ ecosystem: 'pypi', name: 'expresss' }, lists)).toBeUndefined();
  });
  it('applies length thresholds', () => {
    expect(closestPopular(npm('zed'), lists)).toBeUndefined(); // < 5
    expect(closestPopular(npm('reactt'), lists)).toBe('react'); // one edit
    expect(closestPopular(npm('reacttt'), lists)).toBeUndefined(); // two edits
    expect(closestPopular(npm('typescriptz'), lists)).toBe('typescript');
    expect(closestPopular(npm('typescriptzz'), lists)).toBeUndefined();
  });
});

describe('bundled lists', () => {
  it('load with 5,000 names each, including well-known packages', async () => {
    const l = await loadTopLists();
    expect(l.npm.names.size).toBe(5000);
    expect(l.pypi.names.size).toBe(5000);
    expect(l.npm.names.has('express')).toBe(true);
    expect(l.pypi.names.has('requests')).toBe(true);
  });
  it('are within budget: 20 names scanned in under 200 ms', async () => {
    const l = await loadTopLists();
    const refs = Array.from({ length: 20 }, (_, i) => npm(`some-package-name-${i}`));
    const t = performance.now();
    refs.forEach(r => closestPopular(r, l));
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(200);
  });
  it('a missing data folder gives empty lists, no throw', async () => {
    const l = await loadTopLists('/nonexistent');
    expect(l.npm.names.size).toBe(0);
  });
});
