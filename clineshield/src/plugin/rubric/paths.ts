/**
 * paths.ts
 *
 * Path classifiers used by the rubric checks. Paths are display paths
 * (workspace-relative POSIX when inside the workspace).
 */

export type Language = 'js' | 'py' | 'go' | 'java' | 'rs' | 'rb';

const LANG_BY_EXT: Record<string, Language> = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', mts: 'js', cts: 'js',
  py: 'py', go: 'go', java: 'java', kt: 'java', rs: 'rs', rb: 'rb',
};

export function languageOf(path: string): Language | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? LANG_BY_EXT[m[1].toLowerCase()] : undefined;
}

const base = (p: string) => p.split('/').pop() ?? p;

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.(go|py)$/,
  /(^|\/)test_[^/]*\.py$/,
  /Tests?\.(java|kt|cs)$/,
  /_spec\.rb$/,
];
export function isTestPath(p: string): boolean {
  return TEST_PATTERNS.some(r => r.test(p));
}

export function isSecretsFile(p: string): boolean {
  const b = base(p);
  if (/^\.env(\..+)?$/.test(b)) return !/\.(example|sample|template|dist)$/.test(b);
  return (
    /\.(pem|key|p12|pfx|crt|cer|der|jks|keystore)$/i.test(b) ||
    /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|\.netrc|\.pgpass|credentials(\.json)?)$/.test(b) ||
    /^secrets?\.(ya?ml|json|toml)$/i.test(b)
  );
}

export function isCiConfig(p: string): boolean {
  return (
    /^\.github\/workflows\//.test(p) || /^\.circleci\//.test(p) || /^\.buildkite\//.test(p) ||
    /^(\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.yml|\.travis\.yml|bitbucket-pipelines\.yml)$/.test(p)
  );
}

export function isInfra(p: string): boolean {
  const b = base(p);
  return (
    /^Dockerfile/.test(b) || /^docker-compose.*\.ya?ml$/.test(b) || /\.(tf|tfvars)$/.test(b) ||
    /^(Chart\.yaml|kustomization\.ya?ml|serverless\.ya?ml|cdk\.json|Pulumi\..*\.ya?ml)$/.test(b) ||
    /(^|\/)(k8s|kubernetes|helm|charts)\/.*\.ya?ml$/.test(p)
  );
}

export function isMigration(p: string): boolean {
  return /(^|\/)(migrations?|db\/migrate|alembic\/versions)\//.test(p);
}

const MANIFESTS = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
  'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock', 'setup.py', 'setup.cfg',
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'composer.lock',
]);
export function isManifest(p: string): boolean {
  const b = base(p);
  return MANIFESTS.has(b) || /^requirements.*\.txt$/.test(b);
}

export function isGenerated(p: string): boolean {
  return (
    /(^|\/)(dist|build|out|node_modules|vendor|\.next|target|coverage|__pycache__)\//.test(p) ||
    /\.min\.(js|css)$/.test(p) || /\.generated\./.test(p) || /_pb2\.py$/.test(p) || /\.pb\.go$/.test(p)
  );
}

/** Line view of a text: CRLF normalised, one trailing newline does not make an extra line. */
export function toLines(text: string): string[] {
  if (text === '') return [];
  const t = text.replace(/\r\n/g, '\n');
  return (t.endsWith('\n') ? t.slice(0, -1) : t).split('\n');
}
