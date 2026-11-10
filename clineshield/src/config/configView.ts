/**
 * configView.ts
 *
 * The sidebar's config line: what the plugin will use from ~/.cline-shield.yml
 * (SPEC.md Decision 10), read through the plugin's own ConfigStore so values
 * and warnings match. Read-only; never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CONFIG_FILE } from '../plugin/config/store';
import type { ConfigStore } from '../plugin/config/store';

export interface ConfigSummary { preset: string; mode: string; onErrorAllow: boolean; warnings: string[]; fileFound: boolean }

export async function readConfigSummary(store: ConfigStore, homeDir: string): Promise<ConfigSummary> {
  const fileFound = await fs.stat(path.join(homeDir, CONFIG_FILE)).then(() => true, () => false);
  try {
    const { config, warnings } = await store.get();
    return { preset: config.preset, mode: config.mode, onErrorAllow: config.onError === 'allow', warnings: [...warnings], fileFound };
  } catch {
    return { preset: 'balanced', mode: 'enforce', onErrorAllow: false, warnings: [`~/${CONFIG_FILE}: could not be read`], fileFound };
  }
}
