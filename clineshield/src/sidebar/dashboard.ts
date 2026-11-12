/**
 * dashboard.ts
 *
 * Pure model for the sidebar (design: docs/superpowers/specs/2026-11-10-extension-dashboard-design.md):
 * "Waiting on you", totals, recent activity. An ask or block stops waiting when
 * it is approved, the user answers it in chat (answers.json), a newer ask/block
 * replaces it, an action follows 15 s or more later, or it is dismissed (×).
 * No vscode import, no I/O, never
 * throws on malformed events. Text is kept verbatim; the webview escapes it.
 */

import type { Cutoffs, MetricsEvent, RiskReason } from '../types/metrics';
import { summarize } from '../plugin/visibility/report';

export const WAIT_CLEAR_MS = 15000;
export const RECENT_LIMIT = 15;

export interface ActionItem {
  id: string;
  sessionId: string;
  timestamp: string;
  kind: 'edit' | 'command';
  tier: 'allow' | 'ask' | 'block';
  approved?: boolean;
  /** The user's typed reply to this ask or block (answers.json); a yes also sets approved on an ask. */
  answer?: 'yes' | 'no' | 'other';
  target: string;
  files: string[];
  score: number | null;
  reasons: RiskReason[] | null;
  cutoffs: Cutoffs | null;
  reasonText: string | null;
}

export interface Dashboard {
  waiting: ActionItem[];
  totals: {
    edits: { allowed: number; asked: number; approved: number; blocked: number };
    commands: { asked: number; approved: number; blocked: number };
  };
  recent: ActionItem[];
  hasEvents: boolean;
}

type Data = Record<string, unknown>;
interface Ev { index: number; sessionId: string; timestamp: string; type: string; data: Data }

const TIERS = new Set(['allow', 'ask', 'block']);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isReason = (r: unknown): r is RiskReason =>
  typeof r === 'object' && r !== null && typeof (r as RiskReason).rule === 'string' &&
  typeof (r as RiskReason).points === 'number' && typeof (r as RiskReason).description === 'string';
const reasonsOf = (d: Data) => (Array.isArray(d.reasons) ? d.reasons.filter(isReason) : null);
const isCutoffs = (c: unknown): c is Cutoffs =>
  typeof c === 'object' && c !== null && typeof (c as Cutoffs).ask === 'number' && typeof (c as Cutoffs).block === 'number';
const isMarker = (e: Ev) => e.type === 'edit-allowed' && e.data.file === 'session-start';

function validEvents(events: unknown, visible: Set<string>): Ev[] {
  if (!Array.isArray(events)) return [];
  const out: Ev[] = [];
  events.forEach((e, index) => {
    if (typeof e !== 'object' || e === null) return;
    const x = e as Record<string, unknown>;
    if (typeof x.sessionId !== 'string' || !visible.has(x.sessionId)) return;
    if (typeof x.type !== 'string' || typeof x.timestamp !== 'string') return;
    // An unparseable time can't be ordered against answers or the 15 s clear: skip it.
    if (!Number.isFinite(Date.parse(x.timestamp))) return;
    if (typeof x.data !== 'object' || x.data === null) return;
    out.push({ index, sessionId: x.sessionId, timestamp: x.timestamp, type: x.type, data: x.data as Data });
  });
  return out;
}

const EDIT_TIER: Record<string, ActionItem['tier']> = { 'edit-allowed': 'allow', 'edit-approval': 'ask', 'edit-blocked': 'block' };

/** Groups one action's events: per-file edit events share session + timestamp + type; each command event stands alone. */
function groupActions(evs: Ev[]): Ev[][] {
  const groups = new Map<string, Ev[]>();
  for (const e of evs) {
    let key: string;
    if (e.type in EDIT_TIER) {
      if (isMarker(e) || typeof e.data.file !== 'string') continue;
      key = `${e.sessionId}|${e.timestamp}|${e.type}|${e.data.approved === true ? 'ok' : ''}`;
    } else if (e.type === 'command-assessed' && typeof e.data.command === 'string' && TIERS.has(e.data.tier as string)) {
      key = `cmd|${e.index}`;
    } else continue;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()];
}

function editItem(group: Ev[], evs: Ev[]): ActionItem {
  const first = group[0];
  const tier = EDIT_TIER[first.type];
  const files = group.map(e => e.data.file as string);
  const sources = tier === 'allow'
    ? group.flatMap(own => {
      const f = own.data.file;
      // risk-assessed is logged after its edit; the next edit event of the file ends the window.
      const next = evs.find(x => x.index > own.index && x.sessionId === own.sessionId && x.data.file === f &&
        (x.type === 'risk-assessed' || x.type.startsWith('edit-')));
      const r = next?.type === 'risk-assessed' ? next : undefined;
      return r ? [{ score: num(r.data.rulesScore), reasons: reasonsOf(r.data), cutoffs: null }] : [];
    })
    : group.map(e => ({ score: num(e.data.score), reasons: reasonsOf(e.data), cutoffs: isCutoffs(e.data.cutoffs) ? e.data.cutoffs : null }));
  const scores = sources.map(s => s.score).filter((s): s is number => s !== null);
  const reasonLists = sources.map(s => s.reasons).filter((r): r is RiskReason[] => r !== null);
  const reasonText = group.map(e => e.data.reason).find((r): r is string => typeof r === 'string') ?? null;
  return {
    id: `${first.sessionId}|${first.timestamp}|edit|${first.index}`,
    sessionId: first.sessionId, timestamp: first.timestamp, kind: 'edit', tier,
    ...(tier === 'ask' ? { approved: false } : {}),
    target: files.join(', '), files,
    score: scores.length ? Math.max(...scores) : null,
    reasons: reasonLists.length ? reasonLists.flat() : null,
    cutoffs: sources.map(s => s.cutoffs).find((c): c is Cutoffs => c !== null) ?? null,
    reasonText,
  };
}

function commandItem(e: Ev): ActionItem {
  const tier = e.data.tier as ActionItem['tier'];
  return {
    id: `${e.sessionId}|${e.timestamp}|command|${e.index}`,
    sessionId: e.sessionId, timestamp: e.timestamp, kind: 'command', tier,
    ...(tier === 'ask' ? { approved: false } : {}),
    target: e.data.command as string, files: [],
    score: num(e.data.score), reasons: reasonsOf(e.data),
    cutoffs: isCutoffs(e.data.cutoffs) ? e.data.cutoffs : null, reasonText: null,
  };
}

const isApproval = (g: Ev[]) => g[0].data.approved === true && (g[0].type === 'edit-approval' || g[0].type === 'command-assessed');

function buildItems(evs: Ev[]): ActionItem[] {
  const items: ActionItem[] = [];
  for (const group of groupActions(evs)) {
    if (isApproval(group)) {
      const kind = group[0].type === 'command-assessed' ? 'command' : 'edit';
      const target = kind === 'command' ? group[0].data.command : group.map(e => e.data.file).join(', ');
      const asked = [...items].reverse().find(i =>
        i.sessionId === group[0].sessionId && i.kind === kind && i.tier === 'ask' && !i.approved && i.target === target);
      if (asked) asked.approved = true;
      continue;
    }
    const item = group[0].type === 'command-assessed' ? commandItem(group[0]) : editItem(group, evs);
    // A repeat refusal of the same action (no approval in between) is the same ask, as /clineshield counts it.
    if (item.tier === 'ask') {
      const prev = items.findIndex(i => i.sessionId === item.sessionId && i.kind === item.kind && i.tier === 'ask' && !i.approved && i.target === item.target);
      if (prev >= 0) items.splice(prev, 1);
    }
    items.push(item);
  }
  return items;
}

const ANSWERS = new Set(['yes', 'no', 'other']);

/**
 * Applies answers.json entries: each answer belongs to the latest ask or block
 * in its session from before it was given (the plugin records a reply to the
 * latest refusal). The first answer for an item wins.
 */
function applyAnswers(items: ActionItem[], answers: unknown): void {
  if (!Array.isArray(answers)) return;
  for (const a of answers) {
    if (typeof a !== 'object' || a === null) continue;
    const { sessionId, answeredAt, answer } = a as Record<string, unknown>;
    const at = typeof answeredAt === 'string' ? Date.parse(answeredAt) : NaN;
    if (typeof sessionId !== 'string' || !Number.isFinite(at) || !ANSWERS.has(answer as string)) continue;
    const item = [...items].reverse().find(i => i.sessionId === sessionId && i.tier !== 'allow' && Date.parse(i.timestamp) < at);
    if (!item || item.answer) continue;
    item.answer = answer as ActionItem['answer'];
    if (item.tier === 'ask' && answer === 'yes') item.approved = true;
  }
}

function waitingItems(items: ActionItem[], dismissed: ReadonlySet<string>): ActionItem[] {
  const out: ActionItem[] = [];
  for (const sid of new Set(items.map(i => i.sessionId))) {
    const own = items.filter(i => i.sessionId === sid);
    const pos = own.map(i => i.tier !== 'allow').lastIndexOf(true);
    if (pos < 0) continue;
    const latest = own[pos];
    const clearAt = Date.parse(latest.timestamp) + WAIT_CLEAR_MS;
    const movedOn = own.slice(pos + 1).some(i => Date.parse(i.timestamp) >= clearAt);
    if (latest.approved || latest.answer || movedOn || dismissed.has(latest.id)) continue;
    out.push(latest);
  }
  return out.sort((a, b) => items.indexOf(b) - items.indexOf(a));
}

/** `answers` is answers.json's entries (plugin/answers.ts); malformed entries are ignored. */
export function buildDashboard(events: unknown, visibleIds: Set<string>, dismissed: ReadonlySet<string>, answers: unknown = []): Dashboard {
  const evs = validEvents(events, visibleIds);
  const items = buildItems(evs);
  applyAnswers(items, answers);
  const totals: Dashboard['totals'] = {
    edits: { allowed: 0, asked: 0, approved: 0, blocked: 0 },
    commands: { asked: 0, approved: 0, blocked: 0 },
  };
  const raw = (Array.isArray(events) ? events : []) as MetricsEvent[];
  for (const sid of visibleIds) {
    const s = summarize(raw, sid);
    for (const k of ['allowed', 'asked', 'approved', 'blocked'] as const) totals.edits[k] += s.edits[k];
    for (const k of ['asked', 'approved', 'blocked'] as const) totals.commands[k] += s.commands[k];
  }
  return {
    waiting: waitingItems(items, dismissed),
    totals,
    recent: items.slice(-RECENT_LIMIT).reverse(),
    hasEvents: evs.some(e => !isMarker(e)),
  };
}
