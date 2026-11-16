import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { redact, scanDir } from '../redact';

const FAKE = 'sk_live_FAKEevalNOTREAL000000000000';
const ALLOW = [FAKE];

describe('redact', () => {
  it('redacts an sk-ant key', () => {
    const r = redact('key=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv_wxyz-123', ALLOW);
    expect(r.text).toBe('key=[REDACTED]');
    expect(r.hits).toHaveLength(1);
  });
  it('redacts a Bearer header', () => expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def', ALLOW).text).toBe('Authorization: [REDACTED]'));
  it('redacts a GitHub token', () => expect(redact('ghp_' + 'a'.repeat(36), ALLOW).text).toBe('[REDACTED]'));
  it('replaces a macOS home path', () => expect(redact('/Users/someone/project/x.ts', ALLOW).text).toBe('~/project/x.ts'));
  it('keeps the planted fake Stripe key', () => {
    const r = redact(`const key = '${FAKE}';`, ALLOW);
    expect(r.text).toBe(`const key = '${FAKE}';`);
    expect(r.hits).toEqual([]);
  });
  it('redacts a different live Stripe key', () => expect(redact('sk_live_' + 'Z9'.repeat(14), ALLOW).text).toBe('[REDACTED]'));
  it('keeps /home/eval and /work paths', () => expect(redact('/home/eval/.cline and /work/notes-api', ALLOW).text).toBe('/home/eval/.cline and /work/notes-api'));
});

describe('scanDir', () => {
  it('reports a file with a token and passes a clean one', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'ev-red-'));
    await fs.mkdir(path.join(d, 'a'));
    await fs.writeFile(path.join(d, 'a', 'bad.json'), '{"t":"sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv"}');
    await fs.writeFile(path.join(d, 'good.txt'), `fine ${FAKE}`);
    expect(await scanDir(d, ALLOW)).toEqual([path.join(d, 'a', 'bad.json')]);
  });
});
