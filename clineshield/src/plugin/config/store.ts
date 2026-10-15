/**
 * store.ts
 *
 * Loads ~/.cline-shield.yml (personal) and <workspace>/.cline-shield.yml
 * (project), re-parsing only when a file's mtime or size changes. Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { mergeConfigs, validateConfig } from './schema';
import type { PartialConfig, RubricConfig, Source } from './schema';

export const CONFIG_FILE = '.cline-shield.yml';

interface Cached { key: string; config: PartialConfig; warnings: string[] }

export class ConfigStore {
  private cache = new Map<Source, Cached>();
  constructor(private readonly opts: { workspaceRoot: string; homeDir: string }) {}

  private async load(source: Source): Promise<Cached> {
    const file = path.join(source === 'personal' ? this.opts.homeDir : this.opts.workspaceRoot, CONFIG_FILE);
    const label = source === 'personal' ? `~/${CONFIG_FILE}` : CONFIG_FILE;
    let key = 'missing';
    try {
      const st = await fs.stat(file);
      key = `${st.mtimeMs}:${st.size}`;
    } catch {
      key = 'missing';
    }
    const hit = this.cache.get(source);
    if (hit && hit.key === key) return hit;

    let entry: Cached = { key, config: {}, warnings: [] };
    if (key !== 'missing') {
      try {
        const raw = yaml.load(await fs.readFile(file, 'utf-8'), { schema: yaml.CORE_SCHEMA });
        const { config, warnings } = validateConfig(raw, source);
        entry = { key, config, warnings: warnings.map(w => `${label}: ${w}`) };
      } catch {
        entry = { key, config: {}, warnings: [`${label}: YAML parse error, file ignored`] };
      }
    }
    this.cache.set(source, entry);
    return entry;
  }

  async get(): Promise<{ config: RubricConfig; warnings: string[] }> {
    const [personal, project] = await Promise.all([this.load('personal'), this.load('project')]);
    return { config: mergeConfigs(personal.config, project.config), warnings: [...personal.warnings, ...project.warnings] };
  }
}
