import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
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
    const { config, warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(config.preset).toBe('balanced');
    expect(warnings).toEqual([]);
  });

  it('merges personal and project; project cannot loosen', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'preset: relaxed\non_error: allow\n');
    await fs.writeFile(path.join(ws, '.cline-shield.yml'), 'preset: strict\nmode: observe\n');
    const { config, warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(config).toMatchObject({ preset: 'strict', onError: 'allow', mode: 'enforce' });
    expect(warnings.join('\n')).toMatch(/\.cline-shield\.yml: "mode" is only read/);
  });

  it('re-reads after the file changes', async () => {
    const store = new ConfigStore({ workspaceRoot: ws, homeDir: home });
    const file = path.join(ws, '.cline-shield.yml');
    await fs.writeFile(file, 'preset: strict\n');
    expect((await store.get()).config.preset).toBe('strict');
    await fs.writeFile(file, 'preset: relaxed   \n');
    const later = new Date(Date.now() + 5000);
    await fs.utimes(file, later, later);
    expect((await store.get()).config.preset).toBe('relaxed');
  });

  it('broken YAML → file ignored with a warning', async () => {
    await fs.writeFile(path.join(ws, '.cline-shield.yml'), 'preset: [unclosed\n');
    const { config, warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(config.preset).toBe('balanced');
    expect(warnings[0]).toMatch(/YAML parse error/);
  });

  it('a 1.x config file loads without warnings', async () => {
    await fs.copyFile(path.join(__dirname, '../../../../../.cline-shield.example.yml'), path.join(home, '.cline-shield.yml'));
    const { warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(warnings).toEqual([]);
  });

  it('literal 1.x keys load without warnings', async () => {
    await fs.writeFile(path.join(ws, '.cline-shield.yml'), 'no-nuke:\n  max_deleted_functions: 3\nsanity:\n  tools: [eslint]\nrisk:\n  protected_paths: [src/auth/]\n');
    expect((await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get()).warnings).toEqual([]);
  });
});
