/**
 * store.ts
 *
 * Loads ~/.cline-shield.yml, the plugin's only config source (SPEC.md
 * Decision 10): a .cline-shield.yml inside a repo is never read. Re-parses
 * only when the file's mtime or size changes. Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { validateConfig, withDefaults } from './schema';
import type { RubricConfig } from './schema';

export const CONFIG_FILE = '.cline-shield.yml';
const LABEL = `~/${CONFIG_FILE}`;

interface Cached { key: string; config: RubricConfig; warnings: string[] }

export class ConfigStore {
  private cache: Cached | undefined;
  constructor(private readonly opts: { homeDir: string }) {}

  async get(): Promise<{ config: RubricConfig; warnings: string[] }> {
    const file = path.join(this.opts.homeDir, CONFIG_FILE);
    let key = 'missing';
    try {
      const st = await fs.stat(file);
      key = `${st.mtimeMs}:${st.size}`;
    } catch {
      key = 'missing';
    }
    if (this.cache && this.cache.key === key) return this.cache;

    let entry: Cached = { key, config: withDefaults({}), warnings: [] };
    if (key !== 'missing') {
      try {
        const raw = yaml.load(await fs.readFile(file, 'utf-8'), { schema: yaml.CORE_SCHEMA });
        const { config, warnings } = validateConfig(raw);
        entry = { key, config: withDefaults(config), warnings: warnings.map(w => `${LABEL}: ${w}`) };
      } catch {
        entry = { key, config: withDefaults({}), warnings: [`${LABEL}: YAML parse error, file ignored`] };
      }
    }
    this.cache = entry;
    return entry;
  }
}
