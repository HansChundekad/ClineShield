/**
 * schema.ts
 *
 * Rubric configuration (SPEC.md "Rubric configuration"): allowlist
 * validation, personal + project merge, and per-file policy resolution.
 * Pure. Bad values fall back to defaults with a warning; never throws.
 */

import { CATEGORIES, PRESET_CUTOFFS } from '../rubric/categories';
import type { Cutoffs, Preset } from '../rubric/categories';
import { matchesGlob } from '../rubric/glob';
import type { CategoryId } from '../rubric/types';

export type PointsSetting = number | 'off' | 'block';
export type Source = 'personal' | 'project';
type Categories = Partial<Record<CategoryId, PointsSetting>>;

export interface FolderOverride { preset?: Preset; cutoffs?: Partial<Cutoffs>; categories?: Categories }
export interface CustomRule { match: 'path' | 'content' | 'command'; pattern: string; points: number | 'block'; message: string; regex?: RegExp }

export interface PartialConfig {
  mode?: 'enforce' | 'observe';
  preset?: Preset;
  onError?: 'ask' | 'allow';
  offline?: boolean;
  cutoffs?: Partial<Cutoffs>;
  categories?: Categories;
  protectedPaths?: string[];
  trustedCommands?: string[];
  trustedDomains?: string[];
  paths?: Array<{ glob: string; override: FolderOverride }>;
  customRules?: CustomRule[];
}

export interface RubricConfig {
  mode: 'enforce' | 'observe';
  preset: Preset;
  onError: 'ask' | 'allow';
  offline: boolean;
  cutoffs: Partial<Cutoffs>;
  categories: Categories;
  protectedPaths: string[];
  trustedCommands: string[];
  trustedDomains: string[];
  paths: Array<{ glob: string; override: FolderOverride }>;
  customRules: CustomRule[];
}

export interface FilePolicy { cutoffs: Cutoffs; points: Record<CategoryId, PointsSetting> }

/** 1.x `risk.protected_paths` directories; `.env*` is covered by `secrets_file`. */
export const DEFAULT_PROTECTED_PATHS = ['src/auth/**', 'src/config/**', 'src/middleware/**', 'auth/**', 'config/**'];

export const DEFAULT_CONFIG: RubricConfig = {
  mode: 'enforce', preset: 'balanced', onError: 'ask', offline: false, cutoffs: {}, categories: {},
  protectedPaths: DEFAULT_PROTECTED_PATHS, trustedCommands: [], trustedDomains: [], paths: [], customRules: [],
};

const PRESETS = ['relaxed', 'balanced', 'strict'];
const LEGACY_KEYS = new Set(['no-nuke', 'sanity', 'risk', 'gemini_api_key']);
const PERSONAL_ONLY = new Set(['mode', 'on_error', 'offline', 'trusted_commands']);
const MAX_PATTERN = 200;
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}]\)[+*{?]/;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 100;
const strList = (x: unknown) => Array.isArray(x) && x.every(s => typeof s === 'string' && s.length <= MAX_PATTERN);

function cutoffsOf(raw: unknown, base: Cutoffs, where: string, warn: (m: string) => void): Partial<Cutoffs> | undefined {
  if (!isObj(raw)) { warn(`${where}cutoffs must be a mapping; ignored`); return undefined; }
  const out: Partial<Cutoffs> = {};
  for (const k of ['ask', 'block'] as const) {
    if (raw[k] === undefined) continue;
    if (!isInt(raw[k])) { warn(`${where}cutoffs.${k} must be 0-100; ignored`); return undefined; }
    out[k] = raw[k] as number;
  }
  if ((out.ask ?? base.ask) >= (out.block ?? base.block)) { warn(`${where}cutoffs.ask must be below cutoffs.block; ignored`); return undefined; }
  return out;
}

function categoriesOf(raw: unknown, where: string, warn: (m: string) => void): Categories {
  const out: Categories = {};
  if (!isObj(raw)) { warn(`${where}categories must be a mapping; ignored`); return out; }
  for (const [id, val] of Object.entries(raw)) {
    const def = CATEGORIES[id as CategoryId];
    if (!def) { warn(`${where}unknown category "${id}" ignored`); continue; }
    if (def.kind === 'hard') { warn(`${where}hard rule "${id}" can't be configured`); continue; }
    if (isInt(val) || val === 'off' || val === 'block') out[id as CategoryId] = val as PointsSetting;
    else warn(`${where}categories.${id} must be 0-100, off or block; ignored`);
  }
  return out;
}

function customRulesOf(raw: unknown, warn: (m: string) => void): CustomRule[] {
  if (!Array.isArray(raw)) { warn('custom_rules must be a list; ignored'); return []; }
  const out: CustomRule[] = [];
  raw.forEach((r, i) => {
    const where = `custom_rules[${i}]`;
    if (!isObj(r) || !['path', 'content', 'command'].includes(r.match as string) || typeof r.pattern !== 'string' || typeof r.message !== 'string') {
      warn(`${where} needs match (path|content|command), pattern and message; ignored`); return;
    }
    if (!(isInt(r.points) || r.points === 'block')) { warn(`${where}.points must be 0-100 or block; ignored`); return; }
    if (r.pattern.length > MAX_PATTERN || r.message.length > MAX_PATTERN) { warn(`${where} pattern/message longer than ${MAX_PATTERN} chars; ignored`); return; }
    const rule: CustomRule = { match: r.match as CustomRule['match'], pattern: r.pattern, points: r.points as number | 'block', message: r.message };
    if (rule.match !== 'path') {
      if (NESTED_QUANTIFIER.test(rule.pattern)) { warn(`${where}.pattern has nested repeats that could hang; ignored`); return; }
      try { rule.regex = new RegExp(rule.pattern); } catch { warn(`${where}.pattern is not a valid regex; ignored`); return; }
    }
    out.push(rule);
  });
  return out;
}

export function validateConfig(raw: unknown, source: Source): { config: PartialConfig; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const config: PartialConfig = {};
  if (raw === null || raw === undefined) return { config, warnings };
  if (!isObj(raw)) return { config, warnings: ['config is not a YAML mapping; ignored'] };

  for (const [key, val] of Object.entries(raw)) {
    if (LEGACY_KEYS.has(key)) continue;
    if (source === 'project' && PERSONAL_ONLY.has(key)) { warn(`"${key}" is only read from ~/.cline-shield.yml; ignored in the project file`); continue; }
    switch (key) {
      case 'mode': if (val === 'enforce' || val === 'observe') config.mode = val; else warn('mode must be enforce or observe; ignored'); break;
      case 'preset': if (PRESETS.includes(val as string)) config.preset = val as Preset; else warn('preset must be relaxed, balanced or strict; ignored'); break;
      case 'on_error': if (val === 'ask' || val === 'allow') config.onError = val; else warn('on_error must be ask or allow; ignored'); break;
      case 'offline': if (typeof val === 'boolean') config.offline = val; else warn('offline must be true or false; ignored'); break;
      case 'cutoffs': { const c = cutoffsOf(val, PRESET_CUTOFFS[config.preset ?? 'balanced'], '', warn); if (c) config.cutoffs = c; break; }
      case 'categories': config.categories = categoriesOf(val, '', warn); break;
      case 'protected_paths': if (strList(val)) config.protectedPaths = val as string[]; else warn('protected_paths must be a list of short strings; ignored'); break;
      case 'trusted_commands': if (strList(val)) config.trustedCommands = val as string[]; else warn('trusted_commands must be a list of short strings; ignored'); break;
      case 'trusted_domains': if (strList(val)) config.trustedDomains = val as string[]; else warn('trusted_domains must be a list of short strings; ignored'); break;
      case 'paths': {
        if (!isObj(val)) { warn('paths must be a mapping of glob → settings; ignored'); break; }
        config.paths = [];
        for (const [glob, o] of Object.entries(val)) {
          const where = `paths."${glob}".`;
          if (glob.length > MAX_PATTERN || !isObj(o)) { warn(`${where} invalid; ignored`); continue; }
          const override: FolderOverride = {};
          if (o.preset !== undefined) { if (PRESETS.includes(o.preset as string)) override.preset = o.preset as Preset; else warn(`${where}preset invalid; ignored`); }
          if (o.cutoffs !== undefined) { const c = cutoffsOf(o.cutoffs, PRESET_CUTOFFS[override.preset ?? 'balanced'], where, warn); if (c) override.cutoffs = c; }
          if (o.categories !== undefined) override.categories = categoriesOf(o.categories, where, warn);
          config.paths.push({ glob, override });
        }
        break;
      }
      case 'custom_rules': config.customRules = customRulesOf(val, warn); break;
      default: warn(`unknown key "${key}" ignored`);
    }
  }
  return { config, warnings };
}

export function mergeConfigs(personal: PartialConfig, project: PartialConfig): RubricConfig {
  const pick = <K extends keyof PartialConfig>(k: K) => project[k] ?? personal[k];
  const protectedSet = personal.protectedPaths !== undefined || project.protectedPaths !== undefined;
  return {
    mode: pick('mode') ?? DEFAULT_CONFIG.mode,
    preset: pick('preset') ?? DEFAULT_CONFIG.preset,
    onError: pick('onError') ?? DEFAULT_CONFIG.onError,
    offline: pick('offline') ?? DEFAULT_CONFIG.offline,
    cutoffs: { ...personal.cutoffs, ...project.cutoffs },
    categories: { ...personal.categories, ...project.categories },
    protectedPaths: protectedSet ? [...(personal.protectedPaths ?? []), ...(project.protectedPaths ?? [])] : DEFAULT_PROTECTED_PATHS,
    trustedCommands: [...(personal.trustedCommands ?? []), ...(project.trustedCommands ?? [])],
    trustedDomains: [...(personal.trustedDomains ?? []), ...(project.trustedDomains ?? [])],
    paths: [...(project.paths ?? []), ...(personal.paths ?? [])],
    customRules: [...(personal.customRules ?? []), ...(project.customRules ?? [])],
  };
}

export function resolveFilePolicy(config: RubricConfig, path: string): FilePolicy {
  const folder = config.paths.find(p => matchesGlob(path, p.glob))?.override;
  let cutoffs: Cutoffs = { ...PRESET_CUTOFFS[config.preset], ...config.cutoffs };
  if (folder?.preset) cutoffs = { ...PRESET_CUTOFFS[folder.preset] };
  if (folder?.cutoffs) cutoffs = { ...cutoffs, ...folder.cutoffs };
  const points = {} as Record<CategoryId, PointsSetting>;
  for (const [id, def] of Object.entries(CATEGORIES) as Array<[CategoryId, (typeof CATEGORIES)[CategoryId]]>) {
    points[id] = def.kind === 'hard' ? 'block' : folder?.categories?.[id] ?? config.categories[id] ?? def.max;
  }
  return { cutoffs, points };
}
