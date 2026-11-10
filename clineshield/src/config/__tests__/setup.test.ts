import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CONFIG_TEMPLATE, createConfigFromTemplate, isPluginInstalled } from '../setup';
import { validateConfig } from '../../plugin/config/schema';

describe('isPluginInstalled', () => {
  let home: string;
  let repo: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-repo-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });
  const manifest = async (dir: string, name: string) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name }));
  };

  it('false when no plugin folders exist', async () => {
    expect(await isPluginInstalled(home, repo)).toBe(false);
  });

  it('true for a git install under ~/.cline/plugins/_installed', async () => {
    await manifest(path.join(home, '.cline', 'plugins', '_installed', 'abc123'), 'clineshield-cline-plugin');
    expect(await isPluginInstalled(home, repo)).toBe(true);
  });

  it("true for a folder named after ClineShield in the repo's .cline/plugins", async () => {
    await fs.mkdir(path.join(repo, '.cline', 'plugins', 'ClineShield'), { recursive: true });
    expect(await isPluginInstalled(home, repo)).toBe(true);
  });

  it('false for other plugins', async () => {
    await manifest(path.join(home, '.cline', 'plugins', '_installed', 'x'), 'gitignore-guard');
    expect(await isPluginInstalled(home, repo)).toBe(false);
  });

  it('works without a workspace folder', async () => {
    expect(await isPluginInstalled(home, undefined)).toBe(false);
  });
});

describe('createConfigFromTemplate', () => {
  let home: string;
  beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-')); });
  afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

  it('creates ~/.cline-shield.yml when missing', async () => {
    expect(await createConfigFromTemplate(home)).toBe('created');
    expect(await fs.readFile(path.join(home, '.cline-shield.yml'), 'utf-8')).toBe(CONFIG_TEMPLATE);
  });

  it('never overwrites an existing file', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'preset: strict\n');
    expect(await createConfigFromTemplate(home)).toBe('exists');
    expect(await fs.readFile(path.join(home, '.cline-shield.yml'), 'utf-8')).toBe('preset: strict\n');
  });

  it('the template is valid config with no warnings and no em dashes', () => {
    expect(validateConfig(yaml.load(CONFIG_TEMPLATE, { schema: yaml.CORE_SCHEMA }))).toEqual({
      config: { mode: 'enforce', preset: 'balanced', onError: 'ask' }, warnings: [],
    });
    expect(CONFIG_TEMPLATE).not.toContain('—');
  });
});
