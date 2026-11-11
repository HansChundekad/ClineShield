/**
 * aggregate.ts
 *
 * Pure per-file stats for the change map. Level = worst of the after-edit
 * risk-assessed level, an asked edit (medium) and a blocked edit (high), so a
 * file whose edit was blocked never shows low. Commands are not shown.
 * Never throws on malformed events.
 */

export type RiskLevel = 'low' | 'medium' | 'high';
export interface FileStats { editCount: number; worstLevel: RiskLevel | null; blocked: boolean }

const ORDER: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
const LEVELS = new Set<string>(['low', 'medium', 'high']);

export function worstOf(a: RiskLevel | null, b: RiskLevel | null): RiskLevel | null {
  if (!a) return b;
  if (!b) return a;
  return ORDER[a] >= ORDER[b] ? a : b;
}

export function aggregateFileStats(events: unknown): Map<string, FileStats> {
  const stats = new Map<string, FileStats>();
  if (!Array.isArray(events)) return stats;
  const lastApproval = new Map<string, boolean>();
  const get = (file: string) => {
    if (!stats.has(file)) stats.set(file, { editCount: 0, worstLevel: null, blocked: false });
    return stats.get(file)!;
  };

  for (const e of events) {
    if (typeof e !== 'object' || e === null) continue;
    const { type, sessionId, data } = e as { type?: unknown; sessionId?: unknown; data?: unknown };
    if (typeof data !== 'object' || data === null) continue;
    const d = data as Record<string, unknown>;
    const file = d.file;
    if (typeof file !== 'string' || !file || file === 'session-start') continue;

    if (type === 'edit-allowed') get(file).editCount += 1;
    else if (type === 'edit-blocked') {
      const s = get(file);
      s.editCount += 1;
      s.blocked = true;
      s.worstLevel = worstOf(s.worstLevel, 'high');
    } else if (type === 'edit-approval' && typeof d.approved === 'boolean') {
      const key = `${String(sessionId)}|${file}`;
      const s = get(file);
      if (!d.approved && lastApproval.get(key) !== false) s.editCount += 1;
      lastApproval.set(key, d.approved);
      s.worstLevel = worstOf(s.worstLevel, 'medium');
    } else if (type === 'risk-assessed' && typeof d.level === 'string' && LEVELS.has(d.level)) {
      const s = get(file);
      s.worstLevel = worstOf(s.worstLevel, d.level as RiskLevel);
    }
  }
  return stats;
}
