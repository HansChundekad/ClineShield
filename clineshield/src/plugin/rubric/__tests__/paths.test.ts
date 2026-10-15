import {
  isCiConfig, isGenerated, isInfra, isManifest, isMigration, isSecretsFile, isTestPath, languageOf, toLines,
} from '../paths';

describe('path classifiers', () => {
  it.each([
    'src/a.test.ts', 'src/a.spec.jsx', 'src/__tests__/a.ts', 'tests/x.py', 'pkg/a_test.go',
    'test_util.py', 'src/test/java/FooTest.java', 'spec/user_spec.rb', 'test/a.rs',
  ])('test path: %s', p => expect(isTestPath(p)).toBe(true));
  it.each(['src/a.ts', 'src/contest.ts', 'latest.py'])('not a test path: %s', p => expect(isTestPath(p)).toBe(false));

  it('languageOf', () => {
    expect(languageOf('a.tsx')).toBe('js');
    expect(languageOf('a.py')).toBe('py');
    expect(languageOf('a.go')).toBe('go');
    expect(languageOf('A.java')).toBe('java');
    expect(languageOf('A.kt')).toBe('java');
    expect(languageOf('a.rs')).toBe('rs');
    expect(languageOf('a.rb')).toBe('rb');
    expect(languageOf('a.md')).toBeUndefined();
  });

  it.each(['.env', 'config/.env.production', 'certs/server.pem', 'id_rsa', 'k.key', '.netrc', 'secrets.yaml'])(
    'secrets file: %s', p => expect(isSecretsFile(p)).toBe(true));
  it.each(['.env.example', '.env.sample', 'src/env.ts'])('not secrets: %s', p => expect(isSecretsFile(p)).toBe(false));

  it('ci, infra, migration, manifest, generated', () => {
    expect(isCiConfig('.github/workflows/ci.yml')).toBe(true);
    expect(isCiConfig('.gitlab-ci.yml')).toBe(true);
    expect(isCiConfig('src/ci.ts')).toBe(false);
    expect(isInfra('Dockerfile')).toBe(true);
    expect(isInfra('infra/main.tf')).toBe(true);
    expect(isInfra('k8s/deploy.yaml')).toBe(true);
    expect(isInfra('src/docker.ts')).toBe(false);
    expect(isMigration('db/migrate/001_init.rb')).toBe(true);
    expect(isMigration('migrations/0002.sql')).toBe(true);
    expect(isMigration('src/migrate.ts')).toBe(false);
    expect(isManifest('package.json')).toBe(true);
    expect(isManifest('web/yarn.lock')).toBe(true);
    expect(isManifest('requirements-dev.txt')).toBe(true);
    expect(isGenerated('dist/index.js')).toBe(true);
    expect(isGenerated('src/vendor/x.go')).toBe(true);
    expect(isGenerated('app.min.js')).toBe(true);
    expect(isGenerated('src/index.ts')).toBe(false);
  });

  it('toLines ignores one trailing newline and normalises CRLF', () => {
    expect(toLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(toLines('')).toEqual([]);
  });
});
