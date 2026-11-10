import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../../plugin/config/store';
import { readConfigSummary } from '../configView';

describe('readConfigSummary', () => {
  let home: string;
  const write = (text: string) => fs.writeFile(path.join(home, '.cline-shield.yml'), text);
  const read = () => readConfigSummary(new ConfigStore({ homeDir: home }), home);

  beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-cfg-')); });
  afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

  it('no file → defaults, not found', async () => {
    expect(await read()).toEqual({ preset: 'balanced', mode: 'enforce', onErrorAllow: false, warnings: [], fileFound: false });
  });

  it('reflects preset, mode and on_error: allow', async () => {
    await write('preset: strict\nmode: observe\non_error: allow\n');
    expect(await read()).toEqual({ preset: 'strict', mode: 'observe', onErrorAllow: true, warnings: [], fileFound: true });
  });

  it('warns about gemini_api_key without showing it', async () => {
    await write('gemini_api_key: AIzaFAKEFAKE\n');
    const s = await read();
    expect(s.warnings.some(w => w.includes('gemini_api_key is ignored'))).toBe(true);
    expect(s.warnings.join('\n')).not.toContain('AIzaFAKEFAKE');
  });

  it('unparseable YAML → defaults plus a warning', async () => {
    await write('preset: [unclosed\n');
    const s = await read();
    expect(s).toMatchObject({ preset: 'balanced', mode: 'enforce', fileFound: true });
    expect(s.warnings).toHaveLength(1);
  });

  it('picks up a changed file with the same store', async () => {
    const store = new ConfigStore({ homeDir: home });
    await write('preset: strict\n');
    expect((await readConfigSummary(store, home)).preset).toBe('strict');
    await write('preset: relaxed\n# changed size\n');
    expect((await readConfigSummary(store, home)).preset).toBe('relaxed');
  });
});
