/**
 * privateRegistry.ts
 *
 * Whether the user or project installs from a non-public default registry. If
 * so, no package name for that ecosystem may go to the public one. Scoped
 * registry lines don't count: scoped names are never looked up anyway.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { withTimeout } from '../gather';
import { REGISTRY_ENV, isPublicRegistry, registriesIn } from './extract';
import type { Ecosystem } from './extract';

/** `timedOut`: the config couldn't be read in time, so both count as private and nothing is sent. */
export type PrivateEcosystems = Record<Ecosystem, boolean> & { timedOut?: boolean };
async function fileHasRegistry(file: string): Promise<boolean> {
  try {
    const lines = (await fs.readFile(file, 'utf-8')).split(/\r?\n/).filter(l => !/^\s*@/.test(l));
    return registriesIn(file, lines).length > 0;
  } catch (e) {
    // Only a file that isn't there is known to name no registry.
    const code = (e as NodeJS.ErrnoException).code;
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}

const anyFile = async (files: string[]) => (await Promise.all(files.map(fileHasRegistry))).some(Boolean);
const anyEnv = (env: NodeJS.ProcessEnv, keys: string[]) => keys.some(k => !!env[k] && !isPublicRegistry(env[k]!));

/** requirements*.txt in a folder; an unreadable folder has none we can see. */
const requirementFiles = (dir: string) =>
  fs.readdir(dir).then(names => names.filter(n => /^requirements.*\.txt$/.test(n)).map(n => path.join(dir, n)), () => [] as string[]);

/** Checked per action, so a registry added mid-session counts. Any folder being private makes the whole action private. */
export async function privateEcosystems(dirs: string[], home: string, env: NodeJS.ProcessEnv, capMs: number): Promise<PrivateEcosystems> {
  const work = (async () => {
    const reqs = (await Promise.all(dirs.map(requirementFiles))).flat();
    const inDirs = (names: string[]) => dirs.flatMap(d => names.map(n => path.join(d, n)));
    return Promise.all([
      anyFile([...inDirs(['.npmrc', '.yarnrc.yml', '.yarnrc', 'bunfig.toml']), ...['.npmrc', '.yarnrc.yml', '.yarnrc', '.bunfig.toml'].map(n => path.join(home, n))]),
      anyFile([
        ...inDirs(['pip.conf', 'uv.toml', 'pyproject.toml']), ...reqs,
        path.join(home, '.config/pip/pip.conf'), path.join(home, '.pip/pip.conf'), path.join(home, '.config/uv/uv.toml'),
        path.join(home, 'Library/Application Support/pip/pip.conf'), '/etc/pip.conf',
      ]),
    ]);
  })();
  const read = await withTimeout(work, capMs, undefined);
  if (!read) return { npm: true, pypi: true, timedOut: true };
  const [npm, pypi] = read;
  return { npm: npm || anyEnv(env, REGISTRY_ENV.npm), pypi: pypi || anyEnv(env, REGISTRY_ENV.pypi) };
}
