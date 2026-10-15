import { matchesGlob } from '../glob';

describe('matchesGlob', () => {
  it.each([
    ['src/auth/login.ts', 'src/auth/**', true],
    ['src/auth/deep/x.ts', 'src/auth/**', true],
    ['src/authx/login.ts', 'src/auth/**', false],
    ['billing/a.ts', 'billing/**', true],
    ['src/a.ts', '*.ts', true], // slashless glob matches the basename anywhere (gitignore/CODEOWNERS style)
    ['a.ts', '*.ts', true],
    ['src/a.ts', '**/*.ts', true],
    ['a.ts', '**/*.ts', true],
    ['src/a.tsx', 'src/a.ts?', true],
    ['docs/a.md', 'src/**', false],
    ['src/a.b.ts', 'src/a.b.ts', true],
    ['src/axbxts', 'src/a.b.ts', false],
  ])('%s vs %s → %s', (p, g, expected) => {
    expect(matchesGlob(p, g)).toBe(expected);
  });

  it('a glob without a slash matches the basename anywhere (gitignore style)', () => {
    expect(matchesGlob('deep/dir/.env', '.env')).toBe(true);
  });
});
