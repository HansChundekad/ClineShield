/**
 * registry.ts
 *
 * Public npm/PyPI existence lookups: concurrent, capped, cached per session.
 * Never throws and never hangs; anything but a definite 404 or a good answer
 * is 'unknown'. Tests inject a fake Registry or fetch.
 */

import { withTimeout } from '../gather';
import { refKey } from './extract';
import type { DepRef } from './extract';

export type Lookup = { status: 'found'; installScripts: boolean } | { status: 'missing' } | { status: 'unknown' };
export interface Registry { lookup(ref: DepRef, signal: AbortSignal): Promise<Lookup> }

export const MAX_LOOKUPS = 20;
export const UNKNOWN_TTL_MS = 60_000;
const UNKNOWN: Lookup = { status: 'unknown' };
const NPM_NAME = /^[a-z0-9~-][a-z0-9._~-]*$/i;
const PYPI_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME = 214;

/** Scoped names are never sent; malformed names can't be real and never reach a URL. */
export function canLookUp(r: DepRef): boolean {
  return r.name.length <= MAX_NAME && (r.ecosystem === 'npm' ? NPM_NAME : PYPI_NAME).test(r.name);
}

export function httpRegistry(fetchFn: typeof fetch = fetch): Registry {
  return {
    async lookup(r, signal) {
      try {
        const url = r.ecosystem === 'npm'
          ? `https://registry.npmjs.org/${encodeURIComponent(r.name)}/latest`
          : `https://pypi.org/pypi/${encodeURIComponent(r.name)}/json`;
        const res = await fetchFn(url, { method: r.ecosystem === 'npm' ? 'GET' : 'HEAD', signal });
        if (res.status === 404) return { status: 'missing' };
        if (!res.ok) return UNKNOWN;
        if (r.ecosystem === 'pypi') return { status: 'found', installScripts: false };
        const doc = (await res.json()) as { scripts?: Record<string, unknown>; hasInstallScript?: boolean };
        const s = doc.scripts ?? {};
        return { status: 'found', installScripts: doc.hasInstallScript === true || !!(s.preinstall || s.install || s.postinstall) };
      } catch {
        return UNKNOWN;
      }
    },
  };
}

export class LookupCache {
  private readonly entries = new Map<string, { value: Lookup; at: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  get(key: string): Lookup | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.value.status === 'unknown' && this.now() - e.at >= UNKNOWN_TTL_MS) { this.entries.delete(key); return undefined; }
    return e.value;
  }
  set(key: string, value: Lookup): void { this.entries.set(key, { value, at: this.now() }); }
}

/** Answers for every ref within `capMs`. Past MAX_LOOKUPS new requests, the rest are unknown. */
export async function lookupAll(refs: DepRef[], registry: Registry, capMs: number, cache: LookupCache): Promise<Map<string, Lookup>> {
  const out = new Map<string, Lookup>();
  const todo: DepRef[] = [];
  for (const r of refs) {
    const k = refKey(r);
    if (out.has(k)) continue;
    const hit = cache.get(k);
    if (hit) { out.set(k, hit); continue; }
    if (todo.length < MAX_LOOKUPS) todo.push(r);
    out.set(k, UNKNOWN);
  }
  const ac = new AbortController();
  const ask = async (r: DepRef) => registry.lookup(r, ac.signal);
  const answers = await Promise.all(todo.map(r => withTimeout(ask(r), capMs, UNKNOWN)));
  ac.abort();
  todo.forEach((r, i) => { out.set(refKey(r), answers[i]); cache.set(refKey(r), answers[i]); });
  return out;
}
