import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MAX_SIDECAR_DIFF, MAX_SIDECAR_ENTRIES, SIDECAR_FILE, appendSidecar, diffTextFor, readSidecar, sidecarEntry } from '../sidecar';
import type { SidecarEntry } from '../sidecar';

const entry = (i: number): SidecarEntry => ({ sessionId: 's', timestamp: `t${i}`, file: `f${i}.ts`, diff: `+${i}` });

describe('diffTextFor', () => {
  it('prefixes context, removed and added lines of an update', () => {
    const text = diffTextFor({
      type: 'update', path: 'a.ts',
      hunks: [{ endOfFile: false, lines: [{ kind: 'context', text: 'keep' }, { kind: 'remove', text: 'old' }, { kind: 'add', text: 'new' }] }],
    });
    expect(text).toBe(' keep\n-old\n+new');
  });

  it('shows every line of an added file as added, and a delete as a note', () => {
    expect(diffTextFor({ type: 'add', path: 'n.ts', lines: ['a', 'b'] })).toBe('+a\n+b');
    expect(diffTextFor({ type: 'delete', path: 'd.ts' })).toBe('(file deleted)');
  });
});

describe('sidecarEntry', () => {
  it('redacts secrets in the diff', () => {
    const e = sidecarEntry('s1', 't', 'a.ts', { type: 'add', path: 'a.ts', lines: ['const k = "AKIAABCDEFGHIJKLMNOP";'] })!;
    expect(e).toMatchObject({ sessionId: 's1', timestamp: 't', file: 'a.ts' });
    expect(e.diff).toContain('[REDACTED]');
    expect(e.diff).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });

  it('returns undefined for a secrets file', () => {
    expect(sidecarEntry('s', 't', '.env', { type: 'add', path: '.env', lines: ['A=1'] })).toBeUndefined();
  });

  it('caps the diff and marks it truncated', () => {
    const e = sidecarEntry('s', 't', 'big.ts', { type: 'add', path: 'big.ts', lines: Array(2000).fill('xxxxxxxxxx') })!;
    expect(e.diff.endsWith('\n... [truncated]')).toBe(true);
    expect(e.diff.length).toBe(MAX_SIDECAR_DIFF + '\n... [truncated]'.length);
  });
});

describe('appendSidecar / readSidecar', () => {
  let root: string;
  const file = () => path.join(root, '.cline-shield', SIDECAR_FILE);

  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sidecar-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('reads an empty sidecar when the file is missing', async () => {
    expect(await readSidecar(root)).toEqual({ entries: [] });
  });

  it('keeps the newest entries, oldest first', async () => {
    await appendSidecar(root, Array.from({ length: 30 }, (_, i) => entry(i)));
    await appendSidecar(root, Array.from({ length: 30 }, (_, i) => entry(30 + i)));
    const { entries } = await readSidecar(root);
    expect(entries).toHaveLength(MAX_SIDECAR_ENTRIES);
    expect(entries[0].timestamp).toBe('t10');
    expect(entries[entries.length - 1].timestamp).toBe('t59');
  });

  it('replaces a corrupt file with the new entries', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), '{not json');
    await appendSidecar(root, [entry(1)]);
    expect((await readSidecar(root)).entries).toEqual([entry(1)]);
  });

  it('never throws when the sidecar path is a directory', async () => {
    await fs.mkdir(file(), { recursive: true });
    await expect(appendSidecar(root, [entry(1)])).resolves.toBeUndefined();
    expect(await readSidecar(root)).toEqual({ entries: [] });
  });
});
