/**
 * setup.ts
 *
 * Sidebar setup helpers: is the ClineShield plugin installed (empty state
 * 4a vs 4b), and "Create config" (owner decision 2026-11-10: write
 * ~/.cline-shield.yml from a template only when it doesn't exist, after the
 * user confirms). Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CONFIG_FILE } from '../plugin/config/store';

export const PLUGIN_PACKAGE_NAME = 'clineshield-cline-plugin';

export const CONFIG_TEMPLATE = `# ClineShield config. Only this file is read (a .cline-shield.yml inside a repo is ignored).
# Changes apply on the next Cline action. Full key list: .cline-shield.example.yml in the ClineShield repo.

# enforce: asks and blocks apply. observe: only logs (hard rules still block).
mode: enforce

# relaxed, balanced or strict: how readily ClineShield asks and blocks.
preset: balanced

# If ClineShield itself fails: ask (safe default) or allow (the action runs unchecked).
on_error: ask

# Examples (uncomment to use):
# protected_paths: ["src/payments/**"]
# trusted_commands: ["npm test"]
# cutoffs: { ask: 40, block: 70 }
`;

async function dirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => path.join(dir, d.name));
  } catch {
    return [];
  }
}

async function isClineShield(dir: string): Promise<boolean> {
  if (/clineshield/i.test(path.basename(dir))) return true;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8')) as { name?: unknown };
    return pkg?.name === PLUGIN_PACKAGE_NAME;
  } catch {
    return false;
  }
}

/** Looks in ~/.cline/plugins and <workspace>/.cline/plugins, two levels deep (git installs live in _installed/<id>). */
export async function isPluginInstalled(homeDir: string, workspaceRoot: string | undefined): Promise<boolean> {
  const roots = [path.join(homeDir, '.cline', 'plugins'), ...(workspaceRoot ? [path.join(workspaceRoot, '.cline', 'plugins')] : [])];
  for (const root of roots) {
    const level1 = await dirs(root);
    const level2 = (await Promise.all(level1.map(dirs))).flat();
    for (const d of [...level1, ...level2]) if (await isClineShield(d)) return true;
  }
  return false;
}

/** Writes the template only if ~/.cline-shield.yml doesn't exist ('wx'). */
export async function createConfigFromTemplate(homeDir: string): Promise<'created' | 'exists' | 'failed'> {
  try {
    await fs.writeFile(path.join(homeDir, CONFIG_FILE), CONFIG_TEMPLATE, { encoding: 'utf-8', flag: 'wx' });
    return 'created';
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'exists' : 'failed';
  }
}
