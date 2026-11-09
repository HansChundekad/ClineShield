import { addedFromChange, addedRegistries, manifestNames, parseInstall } from '../extract';
import { change, update } from '../../__tests__/fixtures';
import { parseEntries } from '../../commands/parse';
import { simplify } from '../../commands/parse';

const names = (r: Array<{ name: string }> | undefined) => (r ?? []).map(x => x.name).sort();
const install = (cmd: string) => {
  const [p] = parseEntries([{ shell: cmd }], { cwd: '/ws', home: '/home/u', tmpdir: '/tmp' });
  return parseInstall(simplify(p));
};

describe('manifestNames', () => {
  it('reads all four package.json sections', () => {
    const text = JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { a: '1' }, devDependencies: { b: '1' }, peerDependencies: { c: '1' }, optionalDependencies: { d: '1' }, scripts: { e: 'x' } });
    expect(names(manifestNames('package.json', text))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('skips local and git specs and follows npm aliases', () => {
    const text = JSON.stringify({ dependencies: { a: 'file:../a', b: 'workspace:*', c: 'git+https://x/y.git', d: 'user/repo', e: 'https://x/y.tgz', f: 'npm:real@1.0.0' } });
    expect(names(manifestNames('package.json', text))).toEqual(['real']);
  });
  it('returns undefined for invalid package.json', () => {
    expect(manifestNames('package.json', '{ nope')).toBeUndefined();
  });
  it('reads requirements with extras, markers and comments, normalising names', () => {
    const text = ['# c', 'Flask_Login==1.0', 'uvicorn[standard]>=0.2 ; python_version > "3.8"', 'plain  # why', '-r other.txt', '--index-url https://x', 'git+https://x/y.git', './local', 'z @ https://x/z.whl'].join('\n');
    expect(names(manifestNames('requirements-dev.txt', text))).toEqual(['flask-login', 'plain', 'uvicorn']);
  });
  it('reads pyproject PEP 621, optional, groups and Poetry', () => {
    const text = [
      '[project]', 'name = "app"', 'dependencies = [', '  "aaa>=1",', '  "bbb[x]",', ']',
      '[project.optional-dependencies]', 'dev = ["ccc"]',
      '[dependency-groups]', 'test = ["ddd"]',
      '[tool.poetry.dependencies]', 'python = "^3.11"', 'eee = "^1"', 'fff = { path = "../fff" }',
      '[tool.poetry.group.dev.dependencies]', 'ggg = "*"',
      '[tool.other]', 'hhh = "1"',
    ].join('\n');
    expect(names(manifestNames('pyproject.toml', text))).toEqual(['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'ggg']);
  });
  it('inline tables in dependency groups are not packages', () => {
    expect(names(manifestNames('pyproject.toml', '[dependency-groups]\nx = [{include-group = "dev"}, "real"]'))).toEqual(['real']);
  });
  it('ignores other files', () => {
    expect(manifestNames('Cargo.toml', 'x')).toBeUndefined();
  });
});

describe('addedFromChange', () => {
  const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'a', dependencies: deps }, null, 2);

  it('finds a dependency added to an existing package.json', () => {
    const c = change(update('package.json', ['    "a": "1"'], ['    "a": "1",', '    "ghost": "1"'], ['{', '  "dependencies": {']), { original: '{\n  "dependencies": {\n    "a": "1"\n  }\n}\n' });
    expect(names(addedFromChange(c))).toEqual(['ghost']);
  });
  it('a version-only edit adds nothing', () => {
    const c = change(update('package.json', ['    "a": "1"'], ['    "a": "2"'], ['{', '  "dependencies": {']), { original: '{\n  "dependencies": {\n    "a": "1"\n  }\n}\n' });
    expect(addedFromChange(c)).toEqual([]);
  });
  it('a new manifest adds everything', () => {
    const c = change(['*** Add File: requirements.txt', '+aaa', '+bbb==1']);
    expect(names(addedFromChange(c))).toEqual(['aaa', 'bbb']);
  });
  it('writing a whole manifest over an existing one only counts new names', () => {
    const c = change(['*** Add File: requirements.txt', '+aaa', '+bbb'], { original: 'aaa\n', exists: true });
    expect(names(addedFromChange(c))).toEqual(['bbb']);
  });
  it('a removed dependency adds nothing, delete adds nothing', () => {
    expect(addedFromChange(change(['*** Delete File: requirements.txt'], { original: 'aaa\n' }))).toEqual([]);
  });
  it('falls back to added lines when the file is unknown or the patch does not match', () => {
    const add = ['    "ghost": "^1.0.0"', '    "version": "2.0.0"', '    "build": "tsc"'];
    expect(names(addedFromChange(change(update('package.json', [], add))))).toEqual(['ghost']);
    expect(names(addedFromChange(change(update('package.json', ['nope'], add), { original: pkg({}) })))).toEqual(['ghost']);
    expect(names(addedFromChange(change(update('requirements.txt', [], ['aaa==1']))))).toEqual(['aaa']);
  });
  it('invalid package.json falls back without throwing', () => {
    const c = change(update('package.json', [], ['    "ghost": "1.0.0"'], ['{ nope']), { original: '{ nope\n' });
    expect(names(addedFromChange(c))).toEqual(['ghost']);
  });
  it('ignores non-manifests', () => {
    expect(addedFromChange(change(['*** Add File: a.ts', '+requests']))).toEqual([]);
  });
});

describe('parseInstall', () => {
  it.each([
    ['npm install a@1 @s/b -D', ['@s/b', 'a'], 'npm'],
    ['npm i a --save-exact', ['a'], 'npm'],
    ['pnpm add a', ['a'], 'npm'],
    ['yarn add a@latest', ['a'], 'npm'],
    ['bun add a', ['a'], 'npm'],
    ['npm i x@npm:real@1', ['real'], 'npm'],
    ['npm i --prefix sub a', ['a'], 'npm'],
    ["pip install 'Flask_Login[x]>=1' b==2", ['b', 'flask-login'], 'pypi'],
    ['pip3 install -t lib a', ['a'], 'pypi'],
    ['python3 -m pip install a', ['a'], 'pypi'],
    ['uv pip install a', ['a'], 'pypi'],
  ])('%s', (cmd, want, eco) => {
    const r = install(cmd)!;
    expect(names(r.refs)).toEqual(want);
    expect(r.refs.every(x => x.ecosystem === eco)).toBe(true);
  });
  it.each([
    ['npm --prefix web install foo', ['foo']],
    ['npm --registry https://odd.example install foo', ['foo']],
    ['pnpm --filter app add foo', ['foo']],
    ['pnpm -C dir add foo', ['foo']],
    ['yarn --cwd web add foo', ['foo']],
    ['yarn workspace web add foo', ['foo']],
    ['pip --proxy http://p install foo', ['foo']],
    ['pnpm add -w foo', ['foo']],
    ['npm i -w app foo', ['foo']],
    ['npm i --omit dev foo --loglevel silent', ['foo']],
    ['pip install --upgrade-strategy eager --progress-bar off foo', ['foo']],
    ['uv add foo', ['foo']],
    ['poetry add foo@1.2', ['foo']],
    ['pdm add -G dev foo', ['foo']],
    ['pipx install foo', ['foo']],
    ['bun a foo', ['foo']],
  ])('flags and managers: %s', (cmd, want) => {
    expect(names(install(cmd)!.refs)).toEqual(want);
  });
  it.each(['npm i git@github.com:o/r.git', 'pip install foo/'])('no packages: %s', cmd => {
    expect(install(cmd)!.refs).toEqual([]);
  });
  it('sees registries in attached flags and config commands', () => {
    expect(install('pip install -ihttps://odd.example/simple a')!.registries).toEqual(['https://odd.example/simple']);
    expect(install('npm config set registry https://odd.example')!.registries).toEqual(['https://odd.example']);
    expect(install('npm config set registry=https://odd.example')!.registries).toEqual(['https://odd.example']);
    expect(install('pip config set global.index-url https://odd.example')!.registries).toEqual(['https://odd.example']);
    expect(install('npm config set save-exact true')?.registries ?? []).toEqual([]);
  });
  it.each(['npm install', 'npm ci', 'npm i .', 'npm i ./x', 'npm i user/repo', 'npm i https://x/y.tgz', 'npm i $X', 'pip install -r r.txt', 'pip install -e .', 'pip install ./x.whl', 'pip list', 'yarn install', 'ls -la'])('no packages: %s', cmd => {
    expect(install(cmd)?.refs ?? []).toEqual([]);
  });
  it('reports non-public registries only', () => {
    expect(install('npm i a --registry https://odd.example')!.registries).toEqual(['https://odd.example']);
    expect(install('npm i a --registry=https://odd.example')!.registries).toEqual(['https://odd.example']);
    expect(install('pip install a -i https://odd.example/simple')!.registries).toEqual(['https://odd.example/simple']);
    expect(install('pip install a --extra-index-url https://odd.example')!.registries).toEqual(['https://odd.example']);
    expect(install('npm i a --registry https://registry.npmjs.org/')!.registries).toEqual([]);
    expect(install('pip install a -i https://pypi.org/simple')!.registries).toEqual([]);
  });
});

describe('addedRegistries', () => {
  it.each([
    ['.npmrc', 'registry=https://odd.example/'],
    ['.npmrc', '@acme:registry=https://odd.example/'],
    ['.yarnrc.yml', 'npmRegistryServer: "https://odd.example"'],
    ['pip.conf', 'index-url = https://odd.example/simple'],
    ['requirements.txt', '--index-url https://odd.example/simple'],
    ['requirements.txt', '-i https://odd.example/simple'],
    ['requirements.txt', '--extra-index-url=https://odd.example/simple'],
    ['bunfig.toml', 'registry = "https://odd.example"'],
    ['uv.toml', 'index-url = "https://odd.example/simple"'],
    ['uv.toml', '[[index]]'],
    ['pyproject.toml', '[[tool.uv.index]]'],
    ['pyproject.toml', '[[tool.poetry.source]]'],
  ])('%s: %s', (file, line) => {
    expect(addedRegistries(change([`*** Add File: ${file}`, `+${line}`]))).toHaveLength(1);
  });
  it('ignores public registries, removed lines and other files', () => {
    expect(addedRegistries(change(['*** Add File: .npmrc', '+registry=https://registry.npmjs.org/']))).toEqual([]);
    expect(addedRegistries(change(update('.npmrc', ['registry=https://odd.example/'], ['save-exact=true'])))).toEqual([]);
    expect(addedRegistries(change(['*** Add File: notes.txt', '+registry=https://odd.example/']))).toEqual([]);
  });
});
