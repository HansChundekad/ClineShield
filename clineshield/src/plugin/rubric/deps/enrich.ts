/**
 * enrich.ts
 *
 * Dependency work that needs I/O, run after gather and before the synchronous
 * engine (SPEC.md "Failure and time"). Attaches findings to the action; the
 * engine applies overrides, groups and tiers. Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { DEADLINE_MS } from '../engine';
import { withTimeout } from '../gather';
import type { RubricConfig } from '../../config/schema';
import type { ActionContext, RawFinding } from '../types';
import { addedFromChange, manifestNames, refKey, registriesIn } from './extract';
import type { DepRef } from './extract';
import { privateEcosystems } from './privateRegistry';
import { LookupCache, canLookUp, httpRegistry, lookupAll } from './registry';
import type { Lookup, Registry } from './registry';
import { closestPopular, loadTopLists, makeLists } from './typosquat';
import type { TopLists } from './typosquat';

export const REGISTRY_CAP_MS = 800;
/** Kept back for scoring after the lookups. */
export const SCORING_RESERVE_MS = 150;
export const MAX_TYPOSQUAT_SCAN = 20;
const MAX_NAMES_SHOWN = 5;
/** Local file reads; also limited by the time left, so a stuck disk can't pass the deadline. */
const READ_CAP_MS = 600;
const LABEL = { npm: 'npm', pypi: 'PyPI' };

export interface AssessorDeps {
  registry?: Registry;
  now?: () => number;
  loadLists?: () => Promise<TopLists>;
  env?: NodeJS.ProcessEnv;
  readFile?: (file: string) => Promise<string>;
  readCapMs?: number;
}
export type DependencyAssessor = (action: ActionContext, config: RubricConfig, startedAt: number) => Promise<void>;

interface Item {
  refs: DepRef[];
  /** This item names its own non-public registry. */
  ownRegistry: boolean;
  findings: RawFinding[];
  skipped: string[];
}

/** Names already listed by the manifests in the folder a command runs in. */
async function existingNames(dir: string, read: (file: string) => Promise<string>): Promise<Set<string>> {
  const names = await Promise.all(['package.json', 'requirements.txt', 'pyproject.toml'].map(async f => {
    const text = await read(path.join(dir, f)).catch(() => undefined);
    if (text === undefined) return [];
    const listed = manifestNames(f, text);
    if (!listed) throw new Error(`${f} could not be parsed`);
    return listed;
  }));
  return new Set(names.flat().map(refKey));
}

function itemsOf(action: ActionContext): Array<{ item: Item; apply: (i: Item) => void }> {
  return action.changes.flatMap(c => {
    let refs: DepRef[];
    try { refs = addedFromChange(c); } catch (e) {
      console.error('[ClineShield] dependency check crashed:', e);
      c.dependency = { findings: [], skipped: ['dependencies: crashed'] };
      return [];
    }
    if (refs.length === 0) return [];
    const ownRegistry = registriesIn(c.path, [...c.added, ...(c.original ?? '').split(/\r?\n/)]).length > 0;
    return [{ item: { refs, ownRegistry, findings: [], skipped: [] }, apply: (i: Item) => { c.dependency = { findings: i.findings, skipped: i.skipped }; } }];
  });
}

async function commandItems(action: ActionContext, read: (file: string) => Promise<string>, capMs: number): Promise<Array<{ item: Item; apply: (i: Item) => void }>> {
  const cmd = action.command;
  if (!cmd?.installs?.length) return [];
  const refsByInstall = await Promise.all(cmd.installs.map(async inst => {
    // No time left means no lookups, so nothing can leak and the manifest isn't needed.
    if (capMs <= 0) return { inst, refs: inst.refs };
    const known = await withTimeout(existingNames(inst.cwd ?? action.workspaceRoot, read), capMs, undefined);
    // Unknown manifest: a listed private name could leak, so check nothing.
    if (!known) cmd.skipped.push('dependencies: skipped (manifest unknown)');
    return { inst, refs: known ? inst.refs.filter(r => !known.has(refKey(r))) : [] };
  }));
  const refs = new Map(refsByInstall.flatMap(x => x.refs.map(r => [refKey(r), r] as const)));
  if (refs.size === 0) return [];
  const item: Item = { refs: [...refs.values()], ownRegistry: refsByInstall.some(x => x.inst.ownRegistry), findings: [], skipped: [] };
  return [{ item, apply: i => { cmd.findings.push(...i.findings); cmd.skipped.push(...i.skipped); } }];
}

function report(item: Item, lists: TopLists, sent: Set<string>, answers: Map<string, Lookup>): void {
  const scanned = item.refs.slice(0, MAX_TYPOSQUAT_SCAN);
  if (scanned.length < item.refs.length) item.skipped.push('dep_typosquat: skipped (too many packages)');
  for (const r of scanned) {
    const like = closestPopular(r, lists);
    if (like) item.findings.push({ category: 'dep_typosquat', weight: 1, detail: `${r.name} looks like the popular package ${like}` });
  }
  const unverified: string[] = [];
  for (const r of item.refs) {
    if (!sent.has(refKey(r))) continue;
    const a = answers.get(refKey(r));
    if (a?.status === 'missing') item.findings.push({ category: 'dep_missing', weight: 1, detail: `${r.name} was not found on ${LABEL[r.ecosystem]}` });
    else if (a?.status === 'found' && a.installScripts) item.findings.push({ category: 'dep_install_scripts', weight: 1, detail: `${r.name} runs scripts when it is installed` });
    else if (!a || a.status === 'unknown') unverified.push(r.name);
  }
  if (unverified.length > 0) {
    const more = unverified.length - MAX_NAMES_SHOWN;
    const shown = unverified.slice(0, MAX_NAMES_SHOWN).join(', ');
    item.findings.push({ category: 'dep_unverified', weight: 1, detail: `could not check ${shown}${more > 0 ? ` and ${more} more` : ''} on the registry` });
  }
}

export function createDependencyAssessor(deps: AssessorDeps = {}): DependencyAssessor {
  const registry = deps.registry ?? httpRegistry();
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  const cache = new LookupCache(now);
  const read = deps.readFile ?? ((file: string) => fs.readFile(file, 'utf-8'));
  let lists: Promise<TopLists> | undefined;

  return async (action, config, startedAt) => {
    try {
      const remaining = () => DEADLINE_MS - (now() - startedAt) - SCORING_RESERVE_MS;
      const readCap = () => Math.min(deps.readCapMs ?? READ_CAP_MS, remaining());
      const items = [...itemsOf(action), ...(await commandItems(action, read, readCap()))];
      if (items.length === 0) return;
      lists ??= (deps.loadLists ?? loadTopLists)();
      const dirs = [...new Set([action.workspaceRoot, ...action.changes.map(c => path.dirname(c.absPath)), ...(action.command?.installs ?? []).flatMap(i => (i.cwd ? [i.cwd] : []))])];
      const [top, isPrivate] = await Promise.all([withTimeout(lists, Math.max(0, readCap()), makeLists([], [])), privateEcosystems(dirs, action.homeDir, env, Math.max(0, readCap()))]);

      const sendable = (x: Item) => x.refs.filter(r => canLookUp(r) && !isPrivate[r.ecosystem] && !x.ownRegistry);
      const refs = items.flatMap(x => sendable(x.item));
      const capMs = Math.min(REGISTRY_CAP_MS, remaining());
      const blocked = config.offline ? 'offline' : capMs <= 0 || isPrivate.timedOut ? 'time' : undefined;

      let answers = new Map<string, Lookup>();
      if (refs.length > 0 && !blocked) answers = await lookupAll(refs, registry, capMs, cache);
      const sent = new Set(blocked ? [] : refs.map(refKey));

      for (const { item, apply } of items) {
        if (blocked && (sendable(item).length > 0 || isPrivate.timedOut)) item.skipped.push(`dep_registry: skipped (${blocked})`);
        if (!isPrivate.timedOut && (item.ownRegistry || item.refs.some(r => isPrivate[r.ecosystem]))) item.skipped.push('dep_registry: skipped (private registry)');
        report(item, top, sent, answers);
        apply(item);
      }
    } catch (e) {
      console.error('[ClineShield] dependency assessment failed:', e);
    }
  };
}
