import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createDependencyAssessor, MAX_TYPOSQUAT_SCAN } from '../enrich';
import { makeLists } from '../typosquat';
import type { Lookup, Registry } from '../registry';
import { scoreAction } from '../../engine';
import { assessCommands } from '../../commands';
import { withDefaults } from '../../../config/schema';
import type { PartialConfig } from '../../../config/schema';
import { action, change, HOME, ROOT } from '../../__tests__/fixtures';
import { askMessage } from '../../messages';

const lists = makeLists(['express', 'lodash', 'typescript'], ['requests']);
const answers: Record<string, Lookup> = {
  ghost: { status: 'missing' }, scripted: { status: 'found', installScripts: true }, slow: { status: 'unknown' },
};
function fake(fn?: Registry['lookup']) {
  const calls: string[] = [];
  const registry: Registry = { lookup: fn ?? (async r => { calls.push(r.name); return answers[r.name] ?? { status: 'found', installScripts: false }; }) };
  return { calls, assess: createDependencyAssessor({ registry, loadLists: async () => lists, env: {}, readCapMs: 5000 }) };
}
const reqEdit = (...names: string[]) => change(['*** Add File: requirements.txt', ...names.map(n => `+${n}`)]);
const pkgEdit = (...names: string[]) => change(['*** Add File: package.json', '+{"dependencies":{', `+${names.map(n => `"${n}":"^1.0.0"`).join(',')}`, '+}}']);

async function run(subject: { edit?: ReturnType<typeof change>; cmd?: string }, cfg: PartialConfig = {}, f = fake(), root = ROOT, startedAt = Date.now()) {
  const config = withDefaults(cfg);
  let a;
  if (subject.cmd) {
    a = (await assessCommands(subject.cmd, { workspaceRoot: root, homeDir: HOME, pluginDir: '/p', codeownersGlobs: [], trustedCommands: config.trustedCommands })).action!;
  } else a = action([subject.edit!], { workspaceRoot: root });
  await f.assess(a, config, startedAt);
  return { d: scoreAction(a, config), calls: f.calls };
}
const fired = (d: ReturnType<typeof scoreAction>) => d.files.flatMap(x => x.findings.map(y => y.id));
const skipped = (d: ReturnType<typeof scoreAction>) => d.files.flatMap(x => x.skipped);

describe('dependency categories', () => {
  it.each([
    ['ghost', 'dep_missing', 'ask'],
    ['expresss', 'dep_typosquat', 'ask'],
    ['scripted', 'dep_install_scripts', 'allow'],
    ['slow', 'dep_unverified', 'allow'],
  ])('%s → %s (%s), same for edit and command', async (name, id, tier) => {
    const edit = await run({ edit: pkgEdit(name) });
    const cmd = await run({ cmd: `npm install ${name}` });
    expect(fired(edit.d)).toContain(id);
    expect(fired(cmd.d)).toContain(id);
    expect(edit.d.tier).toBe(tier);
    expect(cmd.d.tier).toBe(tier);
  });
  it('a popular package fires nothing', async () => {
    const { d } = await run({ cmd: 'npm install lodash' });
    expect(fired(d)).toEqual([]);
    expect(d.tier).toBe('allow');
  });
  it('new registry asks, in a command and in .npmrc', async () => {
    const a = await run({ cmd: 'npm install lodash --registry https://user:s3cret@odd.example' });
    expect(fired(a.d)).toContain('dep_new_registry');
    expect(a.d.tier).toBe('ask');
    expect(JSON.stringify(a.d.files.flatMap(f => f.findings))).not.toContain('s3cret');
    const b = await run({ edit: change(['*** Add File: .npmrc', '+registry=https://odd.example/']) });
    expect(fired(b.d)).toContain('dep_new_registry');
    expect(b.d.tier).toBe('ask');
  });
  it('sudo plus a made-up package blocks on balanced', async () => {
    expect((await run({ cmd: 'sudo npm install ghost' })).d.tier).toBe('block');
  });
  it('strict blocks a made-up package alone', async () => {
    expect((await run({ cmd: 'npm install ghost' }, { preset: 'strict' })).d.tier).toBe('block');
  });
  it('the dependency group counts once, with manifest', async () => {
    const { d } = await run({ edit: pkgEdit('ghost') });
    expect(d.files[0].score).toBe(80);
    expect(d.files[0].findings.find(f => f.id === 'manifest')?.points).toBe(0);
  });
  it('respects off, block and per-folder presets', async () => {
    expect(fired((await run({ cmd: 'npm i ghost' }, { categories: { dep_missing: 'off' } })).d)).not.toContain('dep_missing');
    expect((await run({ cmd: 'npm i ghost' }, { categories: { dep_missing: 'block' } })).d.tier).toBe('block');
    const scoped = await run({ edit: pkgEdit('ghost') }, { paths: [{ glob: 'package.json', override: { preset: 'strict' } }] });
    expect(scoped.d.tier).toBe('block');
  });
  it('trusted commands are not looked up or scored', async () => {
    const r = await run({ cmd: 'npm install ghost' }, { trustedCommands: ['npm install ghost'] });
    expect(r.calls).toEqual([]);
    expect(fired(r.d)).toEqual([]);
  });
  it('reasons never show points or cut-offs', async () => {
    const { d } = await run({ cmd: 'npm install ghost' });
    expect(askMessage(d)).toContain('ghost was not found on npm');
    expect(askMessage(d)).not.toMatch(/\b(80|40|70)\b/);
  });
});

describe('privacy and network', () => {
  it('offline: true makes no calls, no dep_unverified, typosquat still works', async () => {
    const f = fake();
    const { d } = await run({ cmd: 'npm install expresss ghost' }, { offline: true }, f);
    expect(f.calls).toEqual([]);
    expect(fired(d)).toEqual(['dep_typosquat']);
    expect(skipped(d)).toContain('dep_registry: skipped (offline)');
  });
  it.each(['NPM_CONFIG_REGISTRY=https://odd.example npm i ghost', 'PIP_INDEX_URL=https://odd.example pip install ghost'])('inline registry sends nothing and is flagged: %s', async cmd => {
    const f = fake();
    const { d } = await run({ cmd }, {}, f);
    expect(f.calls).toEqual([]);
    expect(fired(d)).toContain('dep_new_registry');
  });
  it('scoped names are never sent', async () => {
    const f = fake();
    await run({ cmd: 'npm install @acme/ghost' }, {}, f);
    expect(f.calls).toEqual([]);
  });
  it('a command with its own registry sends nothing', async () => {
    const f = fake();
    await run({ cmd: 'npm install ghost --registry https://odd.example' }, {}, f);
    expect(f.calls).toEqual([]);
  });
  it('a requirements file with its own index sends nothing', async () => {
    const f = fake();
    await run({ edit: reqEdit('--index-url https://odd.example/simple', 'ghost') }, {}, f);
    expect(f.calls).toEqual([]);
  });

  describe('with real files', () => {
    let root: string;
    beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-deps-')); });
    afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

    it('a project .npmrc registry stops npm lookups but not PyPI', async () => {
      await fs.writeFile(path.join(root, '.npmrc'), 'registry=https://npm.acme.example/\n');
      const f = fake();
      const a = await run({ cmd: 'npm install ghost' }, {}, f, root);
      expect(f.calls).toEqual([]);
      expect(skipped(a.d)).toContain('dep_registry: skipped (private registry)');
      await run({ cmd: 'pip install ghost' }, {}, f, root);
      expect(f.calls).toEqual(['ghost']);
    });
    it('a scoped-only .npmrc line does not stop lookups', async () => {
      await fs.writeFile(path.join(root, '.npmrc'), '@acme:registry=https://npm.acme.example/\n');
      const f = fake();
      await run({ cmd: 'npm install ghost' }, {}, f, root);
      expect(f.calls).toEqual(['ghost']);
    });
    it('a registry added later in the session stops lookups', async () => {
      const f = fake();
      await run({ cmd: 'npm install first-one' }, {}, f, root);
      await fs.writeFile(path.join(root, '.npmrc'), 'registry=https://npm.acme.example/\n');
      await run({ cmd: 'npm install second-one' }, {}, f, root);
      expect(f.calls).toEqual(['first-one']);
    });
    it('a subfolder .npmrc counts for a command run there', async () => {
      await fs.mkdir(path.join(root, 'web'));
      await fs.writeFile(path.join(root, 'web/.npmrc'), 'registry=https://npm.acme.example/\n');
      const f = fake();
      await run({ cmd: 'cd web && npm install ghost' }, {}, f, root);
      expect(f.calls).toEqual([]);
    });
    it('requirements-dev.txt with an index stops PyPI lookups', async () => {
      await fs.writeFile(path.join(root, 'requirements-dev.txt'), '--index-url https://py.acme.example/simple\n');
      const f = fake();
      await run({ cmd: 'pip install ghost' }, {}, f, root);
      expect(f.calls).toEqual([]);
    });
    it('a broken manifest counts as unknown: nothing is sent', async () => {
      await fs.writeFile(path.join(root, 'package.json'), '{ broken');
      const f = fake();
      const { d } = await run({ cmd: 'npm install internal-thing' }, {}, f, root);
      expect(f.calls).toEqual([]);
      expect(skipped(d)).toContain('dependencies: skipped (manifest unknown)');
    });
    it('a package already in the manifest is not looked up', async () => {
      await fs.writeFile(path.join(root, 'package.json'), '{"dependencies":{"internal-thing":"1.0.0"}}');
      const f = fake();
      await run({ cmd: 'npm install internal-thing' }, {}, f, root);
      expect(f.calls).toEqual([]);
    });
  });

  it('an environment registry stops lookups', async () => {
    const calls: string[] = [];
    const assess = createDependencyAssessor({ loadLists: async () => lists, env: { PIP_INDEX_URL: 'https://py.acme.example/simple' }, readCapMs: 5000, registry: { lookup: async r => { calls.push(r.name); return { status: 'missing' }; } } });
    await run({ cmd: 'pip install ghost' }, {}, { calls, assess } as never);
    expect(calls).toEqual([]);
  });
});

describe('failure and time', () => {
  it('registry failure is dep_unverified, not a crash', async () => {
    const f = fake(async () => { throw new Error('down'); });
    expect(fired((await run({ cmd: 'npm install anything' }, {}, f)).d)).toEqual(['dep_unverified']);
  });
  it('a hanging registry stays within the cap', async () => {
    const f = fake(() => new Promise(() => undefined));
    const t = Date.now();
    const { d } = await run({ cmd: 'npm install anything' }, {}, f);
    expect(Date.now() - t).toBeLessThan(1300);
    expect(fired(d)).toEqual(['dep_unverified']);
  }, 5000);
  it('no time left: no calls, logged as skipped', async () => {
    const f = fake();
    const { d } = await run({ cmd: 'npm install ghost' }, {}, f, ROOT, Date.now() - 1900);
    expect(f.calls).toEqual([]);
    expect(skipped(d)).toContain('dep_registry: skipped (time)');
    expect(fired(d)).toEqual([]);
  });
  it('a huge manifest stays capped', async () => {
    const names = Array.from({ length: 200 }, (_, i) => `package-number-${i}`);
    const f = fake();
    const { d } = await run({ edit: pkgEdit(...names) }, {}, f);
    expect(f.calls).toHaveLength(20);
    expect(fired(d)).toContain('dep_unverified');
    expect(skipped(d)).toContain('dep_typosquat: skipped (too many packages)');
    expect(MAX_TYPOSQUAT_SCAN).toBe(20);
  });
  it('a slow manifest read sends nothing and never hangs', async () => {
    const calls: string[] = [];
    const assess = createDependencyAssessor({
      loadLists: async () => lists, env: {}, readFile: () => new Promise(() => undefined), readCapMs: 100,
      registry: { lookup: async r => { calls.push(r.name); return { status: 'missing' }; } },
    });
    const t = Date.now();
    const { d } = await run({ cmd: 'npm install ghost' }, {}, { calls, assess } as never);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(calls).toEqual([]);
    expect(skipped(d)).toContain('dependencies: skipped (manifest unknown)');
  });
  it('config that cannot be read in time sends nothing and says so', async () => {
    const calls: string[] = [];
    const assess = createDependencyAssessor({ loadLists: async () => lists, env: {}, readCapMs: 0, registry: { lookup: async r => { calls.push(r.name); return { status: 'missing' }; } } });
    const { d } = await run({ edit: pkgEdit('ghost') }, {}, { calls, assess } as never);
    expect(calls).toEqual([]);
    expect(skipped(d)).toContain('dep_registry: skipped (time)');
    expect(skipped(d)).not.toContain('dep_registry: skipped (private registry)');
  });
  it('actions with no packages do no dependency work', async () => {
    const loadLists = jest.fn(async () => lists);
    const assess = createDependencyAssessor({ loadLists, env: {}, registry: { lookup: jest.fn() } });
    const a = action([change(['*** Add File: a.ts', '+x'])]);
    await assess(a, withDefaults({}), Date.now());
    expect(loadLists).not.toHaveBeenCalled();
  });
});
