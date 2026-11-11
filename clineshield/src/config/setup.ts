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

export const CONFIG_TEMPLATE = `# ClineShield config. Only this file is read; a .cline-shield.yml inside a repo is ignored.
# Changes apply on the next Cline action. Every setting is listed below.
# To use an example, remove the "# " at the start of its lines.
# Hard rules (deleting outside the project, placeholder code, adding secrets,
# editing ClineShield's own files) always block and can't be configured.

# enforce = asks and blocks apply. observe = only log them (hard rules still block).
mode: enforce

# How readily ClineShield asks and blocks. relaxed (ask 60, block 90),
# balanced (40, 70) or strict (25, 50).
preset: balanced

# If ClineShield itself fails. ask = safe default. allow = the action runs unchecked.
on_error: ask

# true = never look packages up online (public npm and PyPI).
offline: false

# Your own ask and block scores (0-100, ask lower than block), instead of the preset's.
# cutoffs: { ask: 40, block: 70 }

# Change a category's points, or turn it off, or make it always block.
# Category ids: https://github.com/HansChundekad/ClineShield/blob/main/SPEC.md#risk-rubric
# categories:
#   ci_config: 40
#   generated: off
#   tests_skipped: block

# Paths that always need approval (globs). Setting this replaces the defaults
# (src/auth/**, src/config/**, src/middleware/**, auth/**, config/**).
# CODEOWNERS paths are always protected.
# protected_paths: ["src/payments/**"]

# Commands that are never scored (exact match).
# trusted_commands: ["npm test", "make build"]

# Domains not counted as new when they appear in code.
# trusted_domains: ["api.mycompany.com"]

# Per-folder settings, in every repo. The first matching glob wins.
# paths:
#   "src/auth/**": { preset: strict }
#   "tests/**": { preset: relaxed, categories: { tests_skipped: off } }

# Your own rules. Match a path (glob), added code (regex) or a command (regex).
# custom_rules:
#   - { match: path, pattern: "billing/**", points: 40, message: "Billing code: ask first" }

# No API keys here. The Gemini key for explanations is set in VS Code
# ("ClineShield: Set Gemini API Key").
`;

/**
 * Cline (CLI 3.0.74) installs plugins under <clineDir>/plugins/_installed/<type>/...:
 *   git: git/<host>/<repo-id>/package   npm: npm/<id>/package/node_modules/<name>
 * <clineDir> is $CLINE_DIR or ~/.cline; `--cwd <ws>` installs to <ws>/.cline/plugins.
 * Deep enough for git installs; dot folders and node_modules are not walked.
 */
const MAX_DEPTH = 5;

async function dirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map(d => path.join(dir, d.name));
  } catch {
    return [];
  }
}

async function hasManifest(dir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8')) as { name?: unknown };
    return pkg?.name === PLUGIN_PACKAGE_NAME;
  } catch {
    return false;
  }
}

async function isClineShield(dir: string): Promise<boolean> {
  if (/clineshield/i.test(path.basename(dir))) return true;
  return (await hasManifest(dir)) || hasManifest(path.join(dir, 'node_modules', PLUGIN_PACKAGE_NAME));
}

async function findClineShield(dir: string, depth: number): Promise<boolean> {
  if (depth > MAX_DEPTH) return false;
  for (const d of await dirs(dir)) {
    if (await isClineShield(d)) return true;
    if (await findClineShield(d, depth + 1)) return true;
  }
  return false;
}

const clineDirOf = (homeDir: string, env: NodeJS.ProcessEnv) => env.CLINE_DIR?.trim() || path.join(homeDir, '.cline');

/**
 * Folders to watch for an install. Bases are folders that exist before the
 * install (the Cline dir, the workspace), so a newly created plugins/ folder
 * is still seen.
 */
export function pluginWatchTargets(homeDir: string, workspaceRoot: string | undefined, env: NodeJS.ProcessEnv = process.env): { base: string; pattern: string }[] {
  return [
    { base: clineDirOf(homeDir, env), pattern: 'plugins/**' },
    ...(workspaceRoot ? [{ base: workspaceRoot, pattern: '.cline/plugins/**' }] : []),
  ];
}

/** True if a ClineShield install is found in the global or the workspace plugin folder. Never throws. */
export async function isPluginInstalled(homeDir: string, workspaceRoot: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const roots = [path.join(clineDirOf(homeDir, env), 'plugins'), ...(workspaceRoot ? [path.join(workspaceRoot, '.cline', 'plugins')] : [])];
  for (const root of roots) if (await findClineShield(root, 1)) return true;
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
