/**
 * typosquat.ts
 *
 * `dep_typosquat`: a name close to a popular package but not on the bundled
 * top-5k list (data/, refreshed by scripts/refresh-top-packages.js). No network.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { DepRef, Ecosystem } from './extract';

interface Entry { name: string; counts: Uint8Array }
interface List { names: Set<string>; byLength: Map<number, Entry[]> }
export type TopLists = Record<Ecosystem, List>;

const DATA_DIR = path.join(__dirname, 'data');
const BUCKETS = 37;

/** Letter and digit counts: one edit changes their total difference by at most 2. */
function countsOf(name: string): Uint8Array {
  const out = new Uint8Array(BUCKETS);
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    out[c >= 97 && c <= 122 ? c - 97 : c >= 48 && c <= 57 ? c - 22 : 36]++;
  }
  return out;
}

function countsClose(a: Uint8Array, b: Uint8Array, limit: number): boolean {
  let diff = 0;
  for (let i = 0; i < BUCKETS; i++) if ((diff += Math.abs(a[i] - b[i])) > limit) return false;
  return true;
}

function makeList(names: string[]): List {
  const byLength = new Map<number, Entry[]>();
  for (const name of names) {
    const bucket = byLength.get(name.length);
    const entry = { name, counts: countsOf(name) };
    if (bucket) bucket.push(entry); else byLength.set(name.length, [entry]);
  }
  return { names: new Set(names), byLength };
}

export const makeLists = (npm: string[], pypi: string[]): TopLists => ({ npm: makeList(npm), pypi: makeList(pypi) });

const readNames = (file: string) => fs.readFile(file, 'utf-8').then(t => t.split('\n').filter(Boolean), () => []);

export async function loadTopLists(dir = DATA_DIR): Promise<TopLists> {
  const [npm, pypi] = await Promise.all([readNames(path.join(dir, 'top-npm.txt')), readNames(path.join(dir, 'top-pypi.txt'))]);
  return makeLists(npm, pypi);
}

/** Edit distance with adjacent swaps counted once, at most `max`. */
function within(a: string, b: string, max: number): boolean {
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1);
      cur[j] = d;
    }
    before = prev;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** One edit (a neighbour swap counts as one); short names sit close to too many unrelated ones. */
const maxDistance = (len: number) => (len < 5 ? 0 : 1);

/** The popular package this name resembles, if any. */
export function closestPopular(ref: DepRef, lists: TopLists): string | undefined {
  const name = ref.name.toLowerCase();
  const list = lists[ref.ecosystem];
  const max = maxDistance(name.length);
  if (max === 0 || name.startsWith('@') || list.names.has(name)) return undefined;
  const counts = countsOf(name);
  for (let d = 0; d <= max; d++) {
    for (const len of d === 0 ? [name.length] : [name.length - d, name.length + d]) {
      const hit = list.byLength.get(len)?.find(c => countsClose(counts, c.counts, 2 * max) && within(name, c.name, max));
      if (hit) return hit.name;
    }
  }
  return undefined;
}
