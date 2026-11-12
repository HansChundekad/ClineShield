/**
 * Cline's "Restore chat and workspace" runs `git reset --hard`, `git clean -fd`
 * and `git stash apply` in the user's repo (cline/cline 50e77bc,
 * sdk/packages/core/src/session/checkpoint-restore.ts). Ignored files are left
 * alone, so the plugin makes git ignore .cline-shield/ to keep the audit trail.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createClineShieldPlugin } from '../index';

describe('checkpoint restore keeps the audit trail (plugin)', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8' }).trim();

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-checkpoint-')));
    git('init', '-q');
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('after setup, git ignores everything in .cline-shield/', async () => {
    const plugin = createClineShieldPlugin({ homeDir: root });
    plugin.setup!(null, { workspaceInfo: { rootPath: root }, session: { sessionId: 's1' } } as never);
    await plugin.flush();

    await fs.writeFile(path.join(root, '.cline-shield', 'answers.json'), '{}');
    expect(git('ls-files', '--others', '--exclude-standard')).toBe('');
    expect(git('check-ignore', '.cline-shield/metrics.json')).toBe('.cline-shield/metrics.json');
  });

  it("the logs survive the reset and clean of Cline's workspace restore", async () => {
    await fs.writeFile(path.join(root, 'app.js'), 'a');
    git('add', 'app.js');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    const plugin = createClineShieldPlugin({ homeDir: root });
    plugin.setup!(null, { workspaceInfo: { rootPath: root }, session: { sessionId: 's1' } } as never);
    await plugin.flush();
    await fs.writeFile(path.join(root, '.cline-shield', 'answers.json'), '{}');
    const before = await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8');

    git('reset', '-q', '--hard');
    git('clean', '-fdq');

    expect(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')).toBe(before);
    expect(await fs.readFile(path.join(root, '.cline-shield', 'answers.json'), 'utf-8')).toBe('{}');
  });
});
