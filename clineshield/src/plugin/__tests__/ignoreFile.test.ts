import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { IGNORE_CONTENT, ensureIgnoreFile } from '../ignoreFile';

describe('ensureIgnoreFile', () => {
  let root: string;
  const ignorePath = () => path.join(root, '.cline-shield', '.gitignore');

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clineshield-ignore-'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates .cline-shield/.gitignore that ignores the whole folder', async () => {
    await ensureIgnoreFile(root);
    expect(await fs.readFile(ignorePath(), 'utf-8')).toBe(IGNORE_CONTENT);
    expect(IGNORE_CONTENT.split('\n')).toContain('*');
  });

  it('leaves an existing .gitignore in the folder untouched', async () => {
    await fs.mkdir(path.dirname(ignorePath()), { recursive: true });
    await fs.writeFile(ignorePath(), '!metrics.json\n');
    await ensureIgnoreFile(root);
    expect(await fs.readFile(ignorePath(), 'utf-8')).toBe('!metrics.json\n');
  });

  it('never rejects when the folder cannot be written', async () => {
    await fs.writeFile(path.join(root, '.cline-shield'), 'a file, not a folder');
    await expect(ensureIgnoreFile(root)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
