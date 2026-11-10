/**
 * report.ts
 *
 * Pure counting and formatting for the /clineshield slash command (SPEC.md
 * "Terminal visibility"). Takes events already read from metrics.json; no
 * I/O, never throws on malformed entries. Output goes only to the user's
 * terminal (a reply-only command result never reaches the model).
 */

import type { Cutoffs, MetricsEvent, RiskReason } from '../../types/metrics';

export const USAGE = 'Usage: /clineshield [why]';
const MAX_RISKY = 5;

export interface Summary {
  edits: { allowed: number; asked: number; approved: number; blocked: number };
  commands: { asked: number; approved: number; blocked: number; scored: number };
  riskiest: { file: string; score: number }[];
}

type Data = Record<string, unknown>;
interface Ev { timestamp: string; type: string; data: Data }

/** This session's well-formed events, in file order. */
function sessionEvents(events: MetricsEvent[], sessionId: string): Ev[] {
  if (!Array.isArray(events)) return [];
  return (events as unknown[]).filter((e): e is Ev => {
    if (typeof e !== 'object' || e === null) return false;
    const x = e as Record<string, unknown>;
    return x.sessionId === sessionId && typeof x.type === 'string' && typeof x.timestamp === 'string' &&
      typeof x.data === 'object' && x.data !== null;
  });
}

/** Distinct timestamps: one action's per-file events share one. */
const actions = (evs: Ev[]) => new Set(evs.map(e => e.timestamp)).size;
/**
 * Asks and approvals, per action. An ask is refused in beforeTool (approved:false); after the user's yes the
 * retry logs approved:true, or approved:false again if it was then denied at a prompt. Refusals of the same
 * action (same files / command) with no approval in between are one ask.
 */
function askCounts(evs: Ev[], keyOf: (d: Data) => string): { asked: number; approved: number } {
  const byTime = new Map<string, Ev[]>();
  for (const e of evs) byTime.set(e.timestamp, [...(byTime.get(e.timestamp) ?? []), e]);
  const pendingRefusal = new Set<string>();
  let asked = 0;
  let approved = 0;
  for (const group of byTime.values()) {
    const key = group.map(e => keyOf(e.data)).sort().join('\n');
    if (group[0].data.approved === true) { approved++; pendingRefusal.delete(key); continue; }
    if (!pendingRefusal.has(key)) { asked++; pendingRefusal.add(key); }
  }
  return { asked, approved };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function summarize(events: MetricsEvent[], sessionId: string): Summary {
  const evs = sessionEvents(events, sessionId);
  const of = (type: string, pred: (d: Data) => boolean = () => true) => evs.filter(e => e.type === type && pred(e.data));

  const edits = {
    allowed: actions(of('edit-allowed', d => d.file !== 'session-start')),
    ...askCounts(of('edit-approval', d => typeof d.approved === 'boolean'), d => String(d.file)),
    blocked: actions(of('edit-blocked')),
  };
  const commands = {
    ...askCounts(of('command-assessed', d => d.tier === 'ask'), d => String(d.command)),
    blocked: actions(of('command-assessed', d => d.tier === 'block')),
    scored: actions(of('command-assessed', d => d.tier === 'allow')),
  };

  const best = new Map<string, number>();
  for (const e of evs) {
    const score = e.type === 'risk-assessed' ? num(e.data.rulesScore)
      : e.type === 'edit-blocked' || e.type === 'edit-approval' ? num(e.data.score) : undefined;
    const file = e.data.file;
    if (score === undefined || score <= 0 || typeof file !== 'string') continue;
    best.set(file, Math.max(best.get(file) ?? 0, score));
  }
  const riskiest = [...best].map(([file, score]) => ({ file, score }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, MAX_RISKY);

  return { edits, commands, riskiest };
}

export function formatSummary(s: Summary, cfg: { warnings: string[]; onErrorAllow: boolean }): string {
  const { edits: e, commands: c } = s;
  const asked = (n: number, ok: number) => `${n} asked${ok ? ` (${ok} approved)` : ''}`;
  const empty = !e.allowed && !e.asked && !e.approved && !e.blocked && !c.asked && !c.approved && !c.blocked && !c.scored && !s.riskiest.length;
  const lines = ['ClineShield — this session'];
  if (empty) {
    lines.push('No ClineShield activity in this session yet.');
  } else {
    lines.push(`Edits:    ${e.allowed} allowed · ${asked(e.asked, e.approved)} · ${e.blocked} blocked`);
    lines.push(`Commands: ${asked(c.asked, c.approved)} · ${c.blocked} blocked · ${c.scored} allowed with findings (commands with no findings aren't logged)`);
    if (s.riskiest.length) lines.push(`Riskiest files: ${s.riskiest.map(r => `${r.file} ${r.score}`).join(' · ')}`);
  }
  for (const w of cfg.warnings) lines.push(`Config: ${w}`);
  if (cfg.onErrorAllow) lines.push('Note: on_error: allow — if ClineShield fails, actions run unchecked');
  if (!empty) lines.push('Run /clineshield why for the last ask or block.');
  return lines.join('\n');
}

const isAskOrBlock = (e: Ev) =>
  e.type === 'edit-blocked' || e.type === 'edit-approval' ||
  (e.type === 'command-assessed' && (e.data.tier === 'ask' || e.data.tier === 'block'));

function isReasons(v: unknown): v is RiskReason[] {
  return Array.isArray(v) && v.every(r => typeof r === 'object' && r !== null &&
    typeof (r as Data).rule === 'string' && typeof (r as Data).points === 'number');
}
function isCutoffs(v: unknown): v is Cutoffs {
  return typeof v === 'object' && v !== null && typeof (v as Data).ask === 'number' && typeof (v as Data).block === 'number';
}

/** One file's (or the command's) breakdown. */
function breakdown(name: string, d: Data): string[] {
  const out = [`  ${name}`];
  const score = num(d.score);
  if (score === undefined || !isReasons(d.reasons)) {
    if (typeof d.reason === 'string') out.push(`    ${d.reason}`);
    out.push('    (points not recorded: logged before ClineShield saved them)');
    return out;
  }
  const width = Math.max(0, ...d.reasons.map(r => r.rule.length));
  for (const r of d.reasons) out.push(`    ${r.rule.padEnd(width)}  ${String(r.points).padStart(3)}  ${typeof r.description === 'string' ? r.description : ''}`);
  const cut = isCutoffs(d.cutoffs) ? `   Cut-offs: ask ${d.cutoffs.ask} · block ${d.cutoffs.block}` : '';
  out.push(`    Total: ${score}${cut}`);
  return out;
}

export function formatWhy(events: MetricsEvent[], sessionId: string): string {
  const evs = sessionEvents(events, sessionId);
  let last: Ev | undefined;
  for (let i = evs.length - 1; i >= 0 && !last; i--) if (isAskOrBlock(evs[i])) last = evs[i];
  if (!last) return 'No asks or blocks in this session.';
  const group = evs.filter(e => e.type === last!.type && e.timestamp === last!.timestamp && isAskOrBlock(e));

  const d = last.data;
  const isCommand = last.type === 'command-assessed';
  const blocked = last.type === 'edit-blocked' || (isCommand && d.tier === 'block');
  const outcome = blocked ? 'Blocked' : d.approved === true ? 'Asked — approved by the user' : 'Asked — not approved';
  const lines = [`${outcome} ${isCommand ? 'command' : group.length > 1 ? `edit (${group.length} files)` : 'edit'} at ${last.timestamp}`];
  for (const e of group) {
    lines.push(...breakdown(isCommand ? String(e.data.command ?? '(command)') : String(e.data.file ?? '(unknown file)'), e.data));
  }
  return lines.join('\n');
}
