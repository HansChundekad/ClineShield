/**
 * engine.ts
 *
 * Risk rubric engine (SPEC.md "Risk rubric"): runs the checks with crash and
 * time handling, turns findings into points per the file's config, and picks
 * the tier. Pure apart from Date.now() (injectable) and stderr logging.
 */

import { CATEGORIES, SIZE_GROUP, TEST_FILE_DISCOUNT } from './categories';
import type { Cutoffs } from './categories';
import { ALL_CHECKS } from './checks';
import { rewriteShare } from './checks/files';
import { matchesGlob } from './glob';
import { MAX_LINE_SCAN, resolveFilePolicy } from '../config/schema';
import type { RubricConfig } from '../config/schema';
import type { ActionContext, Check, CategoryId, FileChange, RawFinding, Tier } from './types';

export const DEADLINE_MS = 2000;
const RANK: Record<Tier, number> = { allow: 0, ask: 1, block: 2 };

export interface Finding { id: string; points: number; block: boolean; logOnly: boolean; detail: string; fix: string }
export interface FileScore {
  file: string; score: number; tier: Tier; level: 'low' | 'medium' | 'high'; cutoffs: Cutoffs;
  findings: Finding[]; skipped: string[];
  structuralChangePercent: number; functionsDeleted: number; exportsDeleted: number;
}
export interface Decision { tier: Tier; files: FileScore[]; errored: boolean; errors: string[] }
export interface ScoreOptions { checks?: Check[]; now?: () => number; deadlineMs?: number }

export function levelFor(score: number, cutoffs: Cutoffs): 'low' | 'medium' | 'high' {
  return score >= cutoffs.block ? 'high' : score >= cutoffs.ask ? 'medium' : 'low';
}

function toFinding(raw: RawFinding, setting: number | 'off' | 'block'): Finding | undefined {
  const def = CATEGORIES[raw.category];
  if (setting === 'off') return undefined;
  const base = { id: raw.category, detail: raw.detail, fix: def.fix };
  if (def.kind === 'logOnly') return { ...base, points: 0, block: false, logOnly: true };
  if (setting === 'block') return { ...base, points: 0, block: true, logOnly: false };
  return { ...base, points: Math.round(setting * raw.weight), block: false, logOnly: false };
}

function finalize(f: FileScore, isTest: boolean): void {
  const scored = f.findings.filter(x => !x.logOnly);
  let score = scored.reduce((s, x) => s + x.points, 0);
  if (isTest) {
    const size = scored.filter(x => SIZE_GROUP.has(x.id as CategoryId)).reduce((s, x) => s + x.points, 0);
    score -= Math.min(TEST_FILE_DISCOUNT, size);
  }
  f.score = Math.max(0, Math.min(100, score));
  const blocked = scored.some(x => x.block);
  f.tier = blocked || f.score >= f.cutoffs.block ? 'block' : f.score >= f.cutoffs.ask ? 'ask' : 'allow';
  f.level = blocked ? 'high' : levelFor(f.score, f.cutoffs);
}

export function scoreAction(action: ActionContext, config: RubricConfig, options: ScoreOptions = {}): Decision {
  const checks = options.checks ?? ALL_CHECKS;
  const now = options.now ?? Date.now;
  const deadline = options.deadlineMs ?? DEADLINE_MS;
  const start = now();
  const errors: string[] = [];
  let errored = false;
  const checkOpts = { protectedPaths: config.protectedPaths, trustedDomains: config.trustedDomains };

  const runCheck = (check: Check, c: FileChange, skipped: string[]): RawFinding[] => {
    if (check.kind === 'signal' && now() - start > deadline) { skipped.push(`${check.name}: skipped (time)`); return []; }
    try {
      return check.run(c, action, checkOpts);
    } catch (e) {
      console.error(`[ClineShield] check ${check.name} crashed:`, e);
      if (check.kind === 'critical') { errored = true; errors.push(`${check.name} crashed: ${(e as Error)?.message ?? e}`); }
      else skipped.push(`${check.name}: crashed`);
      return [];
    }
  };

  const files: FileScore[] = action.changes.map(c => {
    const policy = resolveFilePolicy(config, c.path);
    const skipped: string[] = [];
    const raws = checks.filter(k => !k.perAction).flatMap(k => runCheck(k, c, skipped));
    const findings = raws.map(r => toFinding(r, policy.points[r.category])).filter((x): x is Finding => !!x);
    config.customRules.forEach((rule, i) => {
      const hit = rule.match === 'path' ? matchesGlob(c.path, rule.pattern) : rule.match === 'content' ? c.added.some(l => rule.regex!.test(l.slice(0, MAX_LINE_SCAN))) : false;
      if (hit) findings.push({ id: `custom:${i}`, points: rule.points === 'block' ? 0 : rule.points, block: rule.points === 'block', logOnly: false, detail: rule.message, fix: rule.message });
    });
    const count = (k: 'functionsDeleted' | 'exportsDeleted') => raws.reduce((n, r) => n + (r.counts?.[k] ?? 0), 0);
    const share = rewriteShare(c);
    const f: FileScore = {
      file: c.path, score: 0, tier: 'allow', level: 'low', cutoffs: policy.cutoffs, findings, skipped,
      structuralChangePercent: share === undefined ? 0 : Math.floor(share * 100),
      functionsDeleted: count('functionsDeleted'), exportsDeleted: count('exportsDeleted'),
    };
    finalize(f, c.isTest);
    return f;
  });

  if (files.length > 0) {
    const worstIdx = files.reduce((w, f, i) => (RANK[f.tier] > RANK[files[w].tier] || (RANK[f.tier] === RANK[files[w].tier] && f.score > files[w].score) ? i : w), 0);
    const worst = files[worstIdx];
    const policy = resolveFilePolicy(config, worst.file);
    for (const k of checks.filter(x => x.perAction)) {
      for (const r of runCheck(k, action.changes[0], worst.skipped)) {
        const f = toFinding(r, policy.points[r.category]);
        if (f) worst.findings.push(f);
      }
    }
    finalize(worst, action.changes[worstIdx].isTest);
  }

  let tier = files.reduce<Tier>((t, f) => (RANK[f.tier] > RANK[t] ? f.tier : t), 'allow');
  if (errored && config.onError === 'ask' && tier === 'allow') tier = 'ask';
  return { tier, files, errored, errors };
}
