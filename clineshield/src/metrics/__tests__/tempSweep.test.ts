import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { STALE_TEMP_MS, sweepStaleTemps } from '../tempSweep';
import { appendEvent } from '../writer';
import { appendAnswer } from '../../plugin/answers';
import { appendSidecar, SIDECAR_FILE } from '../../plugin/sidecar';
import type { MetricsEvent } from '../../types/metrics';

let root: string;
let dir: string;

const age = async (file: string, ms: number) => {
  const t = (Date.now() - ms) / 1000;
  await fs.utimes(file, t, t);
};
const put = async (name: string, ms = 0) => {
  const p = path.join(dir, name);
  await fs.writeFile(p, '{}');
  if (ms) await age(p, ms);
  return p;
};
const exists = (p: string) => fs.access(p).then(() => true, () => false);
const tmps = async () => (await fs.readdir(dir)).filter(f => f.endsWith('.tmp'));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sweep-'));
  dir = path.join(root, '.cline-shield');
  await fs.mkdir(dir);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('sweepStaleTemps', () => {
  it('uses a 30 s age', () => expect(STALE_TEMP_MS).toBe(30_000));

  it('removes a temp of the target older than 30 s', async () => {
    const old = await put('metrics.json.123.ab.tmp', 31_000);
    await sweepStaleTemps(path.join(dir, 'metrics.json'));
    expect(await exists(old)).toBe(false);
  });

  it('keeps a fresh temp (another writer may be mid-write)', async () => {
    const fresh = await put('metrics.json.123.ab.tmp', 5_000);
    await sweepStaleTemps(path.join(dir, 'metrics.json'));
    expect(await exists(fresh)).toBe(true);
  });

  it('leaves the target, its lock and other files\' temps alone', async () => {
    const keep = [
      await put('metrics.json', 60_000),
      await put('metrics.json.lock', 60_000),
      await put('answers.json.x.tmp', 60_000),
      await put('metrics.json.tmp', 60_000),
    ];
    await sweepStaleTemps(path.join(dir, 'metrics.json'));
    for (const p of keep) expect(await exists(p)).toBe(true);
  });

  it('resolves without throwing when the directory does not exist', async () => {
    await expect(sweepStaleTemps(path.join(root, 'nope', 'metrics.json'))).resolves.toBeUndefined();
  });
});

describe('atomic writers sweep before writing', () => {
  const event = { timestamp: new Date().toISOString(), sessionId: 's', type: 'session-start', data: {} } as unknown as MetricsEvent;

  it('appendEvent removes a stale metrics temp', async () => {
    await put('metrics.json.1.aa.tmp', 60_000);
    await appendEvent(event, root);
    expect(await tmps()).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'metrics.json'), 'utf-8'))).toHaveLength(1);
  });

  it('appendAnswer removes a stale answers temp', async () => {
    await put('answers.json.u.tmp', 60_000);
    await appendAnswer(root, { sessionId: 's', toolCallId: 't', answeredAt: new Date().toISOString(), answer: 'yes' });
    expect(await tmps()).toEqual([]);
  });

  it('appendSidecar removes a stale sidecar temp', async () => {
    await put(`${SIDECAR_FILE}.u.tmp`, 60_000);
    await appendSidecar(root, [{ sessionId: 's', timestamp: new Date().toISOString(), file: 'a.ts', diff: '+x' } as never]);
    expect(await tmps()).toEqual([]);
  });
});
