import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveMetricsRoot } from '../metricsRoot';

describe('resolveMetricsRoot', () => {
  let base: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-root-')));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  function gitInit(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['-C', dir, 'init', '-q']);
  }

  it('returns the git root for a folder nested in a repo', async () => {
    const repo = path.join(base, 'repo');
    gitInit(repo);
    const nested = path.join(repo, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    await expect(resolveMetricsRoot(nested)).resolves.toBe(repo);
  });

  it('returns the folder itself when it is the git root', async () => {
    const repo = path.join(base, 'repo');
    gitInit(repo);
    await expect(resolveMetricsRoot(repo)).resolves.toBe(repo);
  });

  it('returns the folder itself when it is not in a git repo', async () => {
    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);
    await expect(resolveMetricsRoot(plain)).resolves.toBe(plain);
  });

  it('returns the folder unchanged when git cannot run there', async () => {
    const missing = path.join(base, 'does-not-exist');
    await expect(resolveMetricsRoot(missing)).resolves.toBe(missing);
  });
});
