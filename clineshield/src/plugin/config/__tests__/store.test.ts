import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_CONFIG } from '../schema';
import { ConfigStore } from '../store';

describe('ConfigStore', () => {
  let ws: string;
  let home: string;
  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-ws-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
  });
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('zero config → balanced defaults, no warnings', async () => {
    const { config, warnings } = await new ConfigStore({ homeDir: home }).get();
    expect(config.preset).toBe('balanced');
    expect(warnings).toEqual([]);
  });

  it('reads the personal file', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'preset: strict\non_error: allow\nmode: observe\n');
    const { config, warnings } = await new ConfigStore({ homeDir: home }).get();
    expect(config).toMatchObject({ preset: 'strict', onError: 'allow', mode: 'observe' });
    expect(warnings).toEqual([]);
  });

  it('never reads a project .cline-shield.yml (no effect, no warning)', async () => {
    await fs.writeFile(path.join(ws, '.cline-shield.yml'),
      'mode: observe\non_error: allow\npreset: relaxed\ncutoffs: { ask: 99, block: 100 }\ncategories: { rewrite_share: off, ci_config: off }\nprotected_paths: []\nbogus: 1\n');
    const store = new ConfigStore({ homeDir: home, workspaceRoot: ws } as never);
    const { config, warnings } = await store.get();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings).toEqual([]);
  });

  it('re-reads after the file changes', async () => {
    const store = new ConfigStore({ homeDir: home });
    const file = path.join(home, '.cline-shield.yml');
    await fs.writeFile(file, 'preset: strict\n');
    expect((await store.get()).config.preset).toBe('strict');
    await fs.writeFile(file, 'preset: relaxed   \n');
    const later = new Date(Date.now() + 5000);
    await fs.utimes(file, later, later);
    expect((await store.get()).config.preset).toBe('relaxed');
  });

  it('broken YAML → file ignored with a warning', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'preset: [unclosed\n');
    const { config, warnings } = await new ConfigStore({ homeDir: home }).get();
    expect(config.preset).toBe('balanced');
    expect(warnings[0]).toMatch(/YAML parse error/);
  });

  it('a 1.x config file loads without warnings', async () => {
    await fs.copyFile(path.join(__dirname, '../../../../../.cline-shield.example.yml'), path.join(home, '.cline-shield.yml'));
    const { warnings } = await new ConfigStore({ homeDir: home }).get();
    expect(warnings).toEqual([]);
  });

  it('literal 1.x keys load without warnings', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'no-nuke:\n  max_deleted_functions: 3\nsanity:\n  tools: [eslint]\nrisk:\n  protected_paths: [src/auth/]\n');
    expect((await new ConfigStore({ homeDir: home }).get()).warnings).toEqual([]);
  });
});
