/**
 * deps.ts
 *
 * Dependency categories (SPEC.md "Risk rubric"). `dep_new_registry` needs no
 * I/O; the signals were computed before scoring by rubric/deps/enrich.ts.
 */

import { addedRegistries, registryHost } from '../deps/extract';
import type { Check } from '../types';

export const newRegistry: Check = {
  name: 'dep_new_registry',
  kind: 'critical',
  run(c) {
    return addedRegistries(c).map(url => ({ category: 'dep_new_registry' as const, weight: 1, detail: `adds package registry ${registryHost(url)}` }));
  },
};

export const dependencySignals: Check = {
  name: 'dependencies',
  kind: 'signal',
  run: c => c.dependency?.findings ?? [],
};
