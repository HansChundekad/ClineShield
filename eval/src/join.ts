/**
 * Joins each tool call to the metrics.json events ClineShield wrote for it (design §8.2 step 2).
 * The tier comes from the tool result; events add score and reasons. Disagreements are flagged, never resolved.
 */
import { describeAction, Action } from './actions';
import { decisionFromResult } from './session';
import type { MetricsEvent, Tier, ToolCall } from './types';

export interface JoinedCall extends ToolCall {
  action: Action;
  tier: Tier;
  score: number | null;
  reasons: { rule: string; points: number }[];
  events: MetricsEvent[];
  mismatch: string | null;
}

const EDIT_EVENTS = new Set(['edit-allowed', 'edit-approval', 'edit-blocked']);
const SLACK_MS = 2000;

/** The tier an event records, counting an approved retry as allow. */
function eventTier(e: MetricsEvent): Tier {
  if (e.type === 'edit-blocked') return 'block';
  if (e.type === 'edit-approval') return e.data.approved === true ? 'allow' : 'ask';
  if (e.type === 'command-assessed') return e.data.approved === true ? 'allow' : (e.data.tier as Tier);
  return 'allow';
}

const reasonsOf = (e: MetricsEvent) =>
  Array.isArray(e.data.reasons) ? (e.data.reasons as { rule: string; points: number }[]).map(r => ({ rule: r.rule, points: r.points })) : [];
const ms = (e: MetricsEvent) => Date.parse(e.timestamp);

export function joinMetrics(calls: ToolCall[], events: MetricsEvent[], root: string): JoinedCall[] {
  const used = new Set<number>();
  const take = (pred: (e: MetricsEvent) => boolean): MetricsEvent | undefined => {
    const i = events.findIndex((e, k) => !used.has(k) && pred(e));
    if (i === -1) return undefined;
    used.add(i);
    return events[i];
  };

  return calls.map(call => {
    const action = describeAction(call, root);
    const tier = decisionFromResult(call);
    const base = { ...call, action, tier };
    const notBefore = (e: MetricsEvent) => ms(e) >= call.ts - SLACK_MS;

    if (action.kind === 'command') {
      const e = take(x => x.type === 'command-assessed' && x.data.command === action.displayCommand && notBefore(x) && (tier !== 'allow' || eventTier(x) === 'allow'));
      if (!e) return { ...base, score: 0, reasons: [], events: [], mismatch: tier === 'allow' ? null : `result ${tier}, no metrics event` };
      const et = eventTier(e);
      return { ...base, score: Number(e.data.score), reasons: reasonsOf(e), events: [e], mismatch: et === tier ? null : `result ${tier}, event ${et}` };
    }

    if (action.kind === 'edit') {
      const found: MetricsEvent[] = [];
      const mismatches: string[] = [];
      let score: number | null = null;
      const reasons: { rule: string; points: number }[] = [];
      for (const f of action.files) {
        const e = take(x => EDIT_EVENTS.has(x.type) && x.data.file === f.path && notBefore(x));
        if (!e) { mismatches.push(`${f.path}: no metrics event`); continue; }
        found.push(e);
        const et = eventTier(e);
        if (et !== tier) mismatches.push(`${f.path}: result ${tier}, event ${et}`);
        let fileScore = typeof e.data.score === 'number' ? e.data.score : null;
        let fileReasons = reasonsOf(e);
        if (e.type === 'edit-allowed') {
          const r = take(x => x.type === 'risk-assessed' && x.data.file === f.path && ms(x) >= ms(e));
          if (r) { found.push(r); fileScore = Number(r.data.rulesScore); fileReasons = reasonsOf(r); }
        }
        if (fileScore !== null) score = Math.max(score ?? 0, fileScore);
        reasons.push(...fileReasons);
      }
      return { ...base, score, reasons, events: found, mismatch: mismatches.length ? mismatches.join('; ') : null };
    }

    return { ...base, score: null, reasons: [], events: [], mismatch: tier === 'allow' ? null : `result ${tier} on a ${call.name} call` };
  });
}
