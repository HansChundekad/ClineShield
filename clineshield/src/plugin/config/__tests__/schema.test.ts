import { DEFAULT_PROTECTED_PATHS, mergeConfigs, resolveFilePolicy, validateConfig } from '../schema';

const v = (raw: unknown, source: 'personal' | 'project' = 'personal') => validateConfig(raw, source);

describe('validateConfig', () => {
  it('accepts the spec example', () => {
    const { config, warnings } = v({
      mode: 'enforce', preset: 'balanced', on_error: 'ask', offline: false,
      cutoffs: { ask: 40, block: 70 },
      categories: { ci_config: 40, generated: 'off', tests_skipped: 'block' },
      protected_paths: ['src/payments/**'], trusted_commands: ['npm test'], trusted_domains: ['api.x.com'],
      paths: { 'src/auth/**': { preset: 'strict' }, 'tests/**': { preset: 'relaxed' } },
      custom_rules: [{ match: 'path', pattern: 'billing/**', points: 40, message: 'Billing code: ask first' }],
    });
    expect(warnings).toEqual([]);
    expect(config.categories).toEqual({ ci_config: 40, generated: 'off', tests_skipped: 'block' });
    expect(config.paths?.map(p => p.glob)).toEqual(['src/auth/**', 'tests/**']);
  });

  it('ignores 1.x keys silently and warns on unknown keys', () => {
    const { config, warnings } = v({ 'no-nuke': {}, sanity: {}, risk: {}, gemini_api_key: 'k', bogus: 1 });
    expect(config).toEqual({});
    expect(warnings).toEqual(['unknown key "bogus" ignored']);
  });

  it('loosening keys are personal-only', () => {
    const { config, warnings } = v({ mode: 'observe', on_error: 'allow', offline: true, trusted_commands: ['x'], preset: 'strict' }, 'project');
    expect(config).toEqual({ preset: 'strict' });
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toMatch(/only read from ~\/\.cline-shield\.yml/);
  });

  it('bad values fall back with a warning', () => {
    const { config, warnings } = v({
      preset: 'yolo', cutoffs: { ask: 80, block: 20 }, categories: { ci_config: 500, nope: 1, placeholder: 'off' }, offline: 'yes',
    });
    expect(config).toEqual({ categories: {} });
    expect(warnings).toHaveLength(6);
  });

  it('rejects long and catastrophic regexes', () => {
    const { config, warnings } = v({
      custom_rules: [
        { match: 'content', pattern: '(a+)+$', points: 10, message: 'x' },
        { match: 'content', pattern: 'a'.repeat(201), points: 10, message: 'x' },
        { match: 'content', pattern: '([', points: 10, message: 'x' },
        { match: 'content', pattern: 'TODO', points: 'block', message: 'no todos' },
      ],
    });
    expect(config.customRules?.map(r => r.pattern)).toEqual(['TODO']);
    expect(warnings).toHaveLength(3);
  });

  it('non-object root → warning, empty config', () => {
    expect(v('just a string')).toEqual({ config: {}, warnings: ['config is not a YAML mapping; ignored'] });
    expect(v(null)).toEqual({ config: {}, warnings: [] });
  });
});

describe('mergeConfigs + resolveFilePolicy', () => {
  it('defaults: balanced, ask on error, default protected paths', () => {
    const c = mergeConfigs({}, {});
    expect(c).toMatchObject({ mode: 'enforce', preset: 'balanced', onError: 'ask', offline: false });
    expect(c.protectedPaths).toEqual(DEFAULT_PROTECTED_PATHS);
    const p = resolveFilePolicy(c, 'src/a.ts');
    expect(p.cutoffs).toEqual({ ask: 40, block: 70 });
    expect(p.points.rewrite_share).toBe(50);
    expect(p.points.placeholder).toBe('block');
  });

  it('project overrides personal key by key; lists combine', () => {
    const personal = v({ preset: 'relaxed', categories: { ci_config: 10 }, protected_paths: ['a/**'] }).config;
    const project = v({ preset: 'strict', categories: { infra: 5 }, protected_paths: ['b/**'] }, 'project').config;
    const c = mergeConfigs(personal, project);
    expect(c.preset).toBe('strict');
    expect(c.categories).toEqual({ ci_config: 10, infra: 5 });
    expect(c.protectedPaths).toEqual(['a/**', 'b/**']);
  });

  it('per-folder override: first match wins, preset then cutoffs then categories', () => {
    const c = mergeConfigs(v({ paths: { 'src/auth/**': { preset: 'strict', categories: { manifest: 'off' } }, 'src/**': { preset: 'relaxed' } } }).config, {});
    expect(resolveFilePolicy(c, 'src/auth/login.ts')).toMatchObject({ cutoffs: { ask: 25, block: 50 }, points: { manifest: 'off' } });
    expect(resolveFilePolicy(c, 'src/x.ts').cutoffs).toEqual({ ask: 60, block: 90 });
    expect(resolveFilePolicy(c, 'docs/x.md').cutoffs).toEqual({ ask: 40, block: 70 });
  });

  it('config points replace the category max', () => {
    expect(resolveFilePolicy(mergeConfigs(v({ categories: { rewrite_share: 80 } }).config, {}), 'a.ts').points.rewrite_share).toBe(80);
  });
});
