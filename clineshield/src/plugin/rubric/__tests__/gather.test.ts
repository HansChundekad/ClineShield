import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { gatherAction, gitDirtyPaths, readCodeowners } from '../gather';
import { parseApplyPatch } from '../../patch';

const ops = (body: string[]) => parseApplyPatch(['*** Begin Patch', ...body, '*** End Patch'].join('\n')).operations;

describe('gatherAction', () => {
  let root: string;
  const opts = () => ({ workspaceRoot: root, homeDir: os.homedir(), pluginDir: '/nonexistent-plugin', codeownersGlobs: [] });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-gather-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'one\ntwo\nthree\n');
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('reads the original, applies in memory and records line changes', async () => {
    const a = await gatherAction(ops(['*** Update File: a.ts', '@@', ' one', '-two', '+TWO']), opts());
    const c = a.changes[0];
    expect(c.path).toBe('a.ts');
    expect(c.original).toBe('one\ntwo\nthree\n');
    expect(c.originalLineCount).toBe(3);
    expect(c.matched).toBe(true);
    expect(c.removed).toEqual(['two']);
    expect(c.added).toEqual(['TWO']);
    expect(c.exists).toBe(true);
  });

  it('marks a patch that does not match the file as matched=false (patch-only fallback)', async () => {
    const a = await gatherAction(ops(['*** Update File: a.ts', '@@', '-nope', '+x']), opts());
    expect(a.changes[0].matched).toBe(false);
  });

  it('delete with a readable file counts every original line as removed', async () => {
    const a = await gatherAction(ops(['*** Delete File: a.ts']), opts());
    expect(a.changes[0].removed).toEqual(['one', 'two', 'three']);
  });

  it('binary file: no original, binary=true', async () => {
    await fs.writeFile(path.join(root, 'b.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const a = await gatherAction(ops(['*** Delete File: b.png']), opts());
    expect(a.changes[0].binary).toBe(true);
    expect(a.changes[0].original).toBeUndefined();
  });

  it('unreadable/missing file: original undefined, exists=false, no throw', async () => {
    const a = await gatherAction(ops(['*** Update File: missing.ts', '@@', '-x', '+y']), opts());
    expect(a.changes[0].original).toBeUndefined();
    expect(a.changes[0].exists).toBe(false);
    expect(a.changes[0].matched).toBeUndefined();
  });

  it('outside workspace by path and by symlink', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-out-'));
    await fs.symlink(outside, path.join(root, 'link'));
    const a = await gatherAction(ops([
      `*** Update File: ${path.join(outside, 'x.ts')}`, '@@', '-a', '+b',
      '*** Update File: link/y.ts', '@@', '-a', '+b',
      '*** Update File: a.ts', '@@', '-two', '+2',
    ]), opts());
    expect(a.changes.map(c => c.outsideWorkspace)).toEqual([true, true, false]);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('move onto an existing file sets moveTargetExists', async () => {
    await fs.writeFile(path.join(root, 'b.ts'), 'x\n');
    const a = await gatherAction(ops(['*** Update File: a.ts', '*** Move to: b.ts', '@@', '-two', '+2']), opts());
    expect(a.changes[0].moveTo).toBe('b.ts');
    expect(a.changes[0].moveTargetExists).toBe(true);
  });

  it('git dirty files are flagged; non-repo leaves gitDirty undefined', async () => {
    const a1 = await gatherAction(ops(['*** Update File: a.ts', '@@', '-two', '+2']), opts());
    expect(a1.changes[0].gitDirty).toBeUndefined();
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: root });
    expect((await gitDirtyPaths(root))?.has('a.ts')).toBe(false);
    await fs.writeFile(path.join(root, 'a.ts'), 'changed\n');
    const a2 = await gatherAction(ops(['*** Update File: a.ts', '@@', '-changed', '+x']), opts());
    expect(a2.changes[0].gitDirty).toBe(true);
  });

  it('readCodeowners turns CODEOWNERS entries into globs', async () => {
    await fs.mkdir(path.join(root, '.github'));
    await fs.writeFile(path.join(root, '.github', 'CODEOWNERS'), '# c\n/src/payments/ @team\n*.sql @dba\n\n');
    expect(await readCodeowners(root)).toEqual(['src/payments/**', '*.sql']);
  });

  it('out of gather budget: fields unknown, outside-workspace still checked lexically', async () => {
    const a = await gatherAction(ops(['*** Update File: /etc/hosts', '@@', '-a', '+b', '*** Update File: a.ts', '@@', '-two', '+2']), { ...opts(), budgetMs: 0 });
    expect(a.changes.map(c => c.outsideWorkspace)).toEqual([true, false]);
    expect(a.changes[1].original).toBeUndefined();
  });

  it('respects the gather budget: a slow git yields gitDirty undefined, not a hang', async () => {
    const a = await gatherAction(ops(['*** Update File: a.ts', '@@', '-two', '+2']), { ...opts(), gitTimeoutMs: 0 });
    expect(a.changes[0].gitDirty).toBeUndefined();
  });
});
