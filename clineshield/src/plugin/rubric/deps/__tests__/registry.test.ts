import { LookupCache, canLookUp, httpRegistry, lookupAll } from '../registry';
import type { Lookup, Registry } from '../registry';
import { refKey } from '../extract';
import type { DepRef } from '../extract';

const npm = (name: string): DepRef => ({ ecosystem: 'npm', name });
const FOUND: Lookup = { status: 'found', installScripts: false };
const answering = (fn: (r: DepRef) => Lookup | Promise<Lookup>) => {
  const calls: string[] = [];
  const registry: Registry = { lookup: async r => { calls.push(r.name); return fn(r); } };
  return { calls, registry };
};
const never = () => new Promise<Lookup>(() => undefined);
const response = (status: number, body: unknown = {}) => ({ status, ok: status < 400, json: async () => body }) as Response;
const http = (r: Response | Error) => httpRegistry(async () => { if (r instanceof Error) throw r; return r; });
const signal = new AbortController().signal;

describe('httpRegistry', () => {
  it('404 is missing, and only 404', async () => {
    expect(await http(response(404)).lookup(npm('a'), signal)).toEqual({ status: 'missing' });
    for (const s of [429, 500, 503]) expect((await http(response(s)).lookup(npm('a'), signal)).status).toBe('unknown');
  });
  it('network errors and bad bodies are unknown', async () => {
    expect((await http(new Error('down')).lookup(npm('a'), signal)).status).toBe('unknown');
    const bad = { status: 200, ok: true, json: async () => { throw new Error('x'); } } as unknown as Response;
    expect((await http(bad).lookup(npm('a'), signal)).status).toBe('unknown');
  });
  it('detects npm install scripts', async () => {
    const yes = await http(response(200, { scripts: { postinstall: 'node x' } })).lookup(npm('a'), signal);
    expect(yes).toEqual({ status: 'found', installScripts: true });
    const flag = await http(response(200, { hasInstallScript: true })).lookup(npm('a'), signal);
    expect(flag).toEqual({ status: 'found', installScripts: true });
    const no = await http(response(200, { scripts: { test: 'jest' } })).lookup(npm('a'), signal);
    expect(no).toEqual({ status: 'found', installScripts: false });
  });
  it('calls the expected public URLs', async () => {
    const urls: Array<[string, string | undefined]> = [];
    const r = httpRegistry(async (u, init) => { urls.push([String(u), init?.method]); return response(200); });
    await r.lookup(npm('a'), signal);
    await r.lookup({ ecosystem: 'pypi', name: 'flask-login' }, signal);
    expect(urls).toEqual([['https://registry.npmjs.org/a/latest', 'GET'], ['https://pypi.org/pypi/flask-login/json', 'HEAD']]);
  });
});

describe('canLookUp', () => {
  it('rejects scoped and malformed names', () => {
    expect(canLookUp(npm('@acme/x'))).toBe(false);
    expect(canLookUp(npm('../etc/passwd'))).toBe(false);
    expect(canLookUp(npm('a b'))).toBe(false);
    expect(canLookUp(npm('x'.repeat(215)))).toBe(false);
    expect(canLookUp(npm('lodash.get'))).toBe(true);
    expect(canLookUp({ ecosystem: 'pypi', name: 'flask-login' })).toBe(true);
  });
});

describe('lookupAll', () => {
  it('returns answers keyed by package', async () => {
    const { registry } = answering(r => (r.name === 'ghost' ? { status: 'missing' } : FOUND));
    const out = await lookupAll([npm('a'), npm('ghost')], registry, 100, new LookupCache());
    expect(out.get(refKey(npm('ghost')))).toEqual({ status: 'missing' });
    expect(out.get(refKey(npm('a')))).toEqual(FOUND);
  });
  it('a hung registry resolves at the cap as unknown and aborts', async () => {
    let aborted = false;
    const registry: Registry = { lookup: (_r, s) => { s.addEventListener('abort', () => { aborted = true; }); return never(); } };
    const t = Date.now();
    const out = await lookupAll([npm('a')], registry, 30, new LookupCache());
    expect(Date.now() - t).toBeLessThan(1000);
    expect(out.get(refKey(npm('a')))?.status).toBe('unknown');
    expect(aborted).toBe(true);
  });
  it('a throwing registry is unknown', async () => {
    const registry: Registry = { lookup: () => { throw new Error('boom'); } };
    const out = await lookupAll([npm('a')], registry, 50, new LookupCache());
    expect(out.get(refKey(npm('a')))?.status).toBe('unknown');
  });
  it('runs lookups at the same time, so many packages still fit the cap', async () => {
    const { registry } = answering(() => new Promise(res => setTimeout(() => res(FOUND), 40)));
    const refs = Array.from({ length: 20 }, (_, i) => npm(`p${i}`));
    const t = Date.now();
    const out = await lookupAll(refs, registry, 500, new LookupCache());
    expect(Date.now() - t).toBeLessThan(500);
    expect([...out.values()].every(v => v.status === 'found')).toBe(true);
  });
  it('makes at most 20 requests; the rest are unknown', async () => {
    const { calls, registry } = answering(() => FOUND);
    const out = await lookupAll(Array.from({ length: 200 }, (_, i) => npm(`p${i}`)), registry, 100, new LookupCache());
    expect(calls).toHaveLength(20);
    expect(out.size).toBe(200);
    expect([...out.values()].filter(v => v.status === 'unknown')).toHaveLength(180);
  });
  it('asks once per package per session', async () => {
    const { calls, registry } = answering(() => FOUND);
    const cache = new LookupCache();
    await lookupAll([npm('a'), npm('a')], registry, 100, cache);
    await lookupAll([npm('a')], registry, 100, cache);
    expect(calls).toEqual(['a']);
  });
  it('remembers unknown for 60 s only', async () => {
    let now = 0;
    const { calls, registry } = answering(() => ({ status: 'unknown' }));
    const cache = new LookupCache(() => now);
    await lookupAll([npm('a')], registry, 100, cache);
    now = 59_000;
    await lookupAll([npm('a')], registry, 100, cache);
    expect(calls).toHaveLength(1);
    now = 61_000;
    await lookupAll([npm('a')], registry, 100, cache);
    expect(calls).toHaveLength(2);
  });
});
