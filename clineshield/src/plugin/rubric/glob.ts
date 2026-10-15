/**
 * glob.ts
 *
 * Minimal glob matcher for config paths and CODEOWNERS: `**` any depth,
 * `*` within a segment, `?` one char. A glob without "/" matches the
 * basename anywhere (gitignore style). Paths are workspace-relative POSIX.
 */

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  let g = glob.replace(/^\.\//, '').replace(/^\//, '');
  if (!g.includes('/')) g = `**/${g}`;
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      const slash = g[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`);
  cache.set(glob, out);
  return out;
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}
