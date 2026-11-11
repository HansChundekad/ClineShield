import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CONFIG_TEMPLATE, createConfigFromTemplate, isPluginInstalled } from '../setup';
import { CONFIG_KEYS, validateConfig } from '../../plugin/config/schema';

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

  it('true for the real git install layout (_installed/git/<host>/<repo-id>/package)', async () => {
    const id = path.join(home, '.cline', 'plugins', '_installed', 'git', 'github.com', 'someone-fork-2ed8deb762f7');
    await manifest(id, 'fork');
    await manifest(path.join(id, 'package'), 'clineshield-cline-plugin');
    expect(await isPluginInstalled(home, repo)).toBe(true);
  });

  it('false for another plugin in the real git install layout', async () => {
    const id = path.join(home, '.cline', 'plugins', '_installed', 'git', 'github.com', 'someone-guard-1a2b3c');
    await manifest(id, 'guard');
    await manifest(path.join(id, 'package'), 'gitignore-guard');
    expect(await isPluginInstalled(home, repo)).toBe(false);
  });

  it('true for an npm install (_installed/npm/<id>/package/node_modules/<name>)', async () => {
    const pkg = path.join(home, '.cline', 'plugins', '_installed', 'npm', 'x-1a2b', 'package');
    await manifest(pkg, 'cline-plugin-install');
    await manifest(path.join(pkg, 'node_modules', 'clineshield-cline-plugin'), 'clineshield-cline-plugin');
    expect(await isPluginInstalled(home, repo)).toBe(true);
  });

  it('honours CLINE_DIR for the plugin root', async () => {
    const clineDir = path.join(home, 'custom-cline');
    await manifest(path.join(clineDir, 'plugins', '_installed', 'git', 'github.com', 'a-b-1', 'package'), 'clineshield-cline-plugin');
    expect(await isPluginInstalled(home, repo, {})).toBe(false);
    expect(await isPluginInstalled(home, repo, { CLINE_DIR: clineDir })).toBe(true);
  });

  it("does not treat a dependency inside another plugin's node_modules as installed", async () => {
    const pkg = path.join(home, '.cline', 'plugins', '_installed', 'git', 'github.com', 'other-1', 'package');
    await manifest(pkg, 'other');
    await manifest(path.join(pkg, 'node_modules', 'some-dep', 'node_modules', 'clineshield-cline-plugin'), 'clineshield-cline-plugin');
    expect(await isPluginInstalled(home, repo)).toBe(false);
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
      config: { mode: 'enforce', preset: 'balanced', onError: 'ask', offline: false }, warnings: [],
    });
    expect(CONFIG_TEMPLATE).not.toContain('—');
  });
});

// Every option a user can set must be discoverable in the file they edit (owner decision 2026-11-11).
describe('CONFIG_TEMPLATE lists every option', () => {
  const SAMPLES: Record<string, unknown> = {
    mode: 'observe', preset: 'strict', on_error: 'allow', offline: true, cutoffs: { ask: 30, block: 60 },
    categories: { generated: 'off' }, protected_paths: ['a/**'], trusted_commands: ['npm test'], trusted_domains: ['x.com'],
    paths: { 'a/**': { preset: 'strict' } }, custom_rules: [{ match: 'path', pattern: 'b/**', points: 10, message: 'm' }],
  };
  /** Removes "# " from example lines (a key or an indented line), leaving prose comments. */
  const uncommentExamples = (t: string) => t.split('\n').map(l => l.replace(/^# (?=[a-z_]+:|\s)/, '')).join('\n');

  it('CONFIG_KEYS is exactly the keys the schema accepts', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...CONFIG_KEYS].sort());
    for (const key of CONFIG_KEYS) expect(validateConfig({ [key]: SAMPLES[key] }).warnings).toEqual([]);
    expect(validateConfig({ nope: 1 }).warnings).toEqual(['unknown key "nope" ignored']);
  });

  it('every key appears as a setting or an example line', () => {
    for (const key of CONFIG_KEYS) expect(CONFIG_TEMPLATE).toMatch(new RegExp(`^(# )?${key}:`, 'm'));
  });

  it('uncommenting every example still gives valid config with no warnings', () => {
    const { config, warnings } = validateConfig(yaml.load(uncommentExamples(CONFIG_TEMPLATE), { schema: yaml.CORE_SCHEMA }));
    expect(warnings).toEqual([]);
    expect(Object.keys(config).length).toBe(CONFIG_KEYS.length);
  });
});
