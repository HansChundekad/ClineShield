import type { Row } from './summary';

export const COLUMNS: (keyof Row)[] = [
  'runId', 'model', 'task', 'taskLabel', 'toolCallId', 'order', 'tool', 'target', 'label', 'labelRule', 'tier', 'score', 'reasons',
  'mismatch', 'outcome', 'nextMove', 'replayMs', 'liveMs', 'replayTier_relaxed', 'replayTier_balanced', 'replayTier_strict', 'approximate',
  'labelFinal', 'reviewNote', 'ownerDisagrees',
];
const MANUAL: (keyof Row)[] = ['labelFinal', 'reviewNote', 'ownerDisagrees'];

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Row[]): string {
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\n') + '\n';
}

/** Parses CSV written by toCsv (quoted fields, embedded commas, quotes and newlines). Values stay strings. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { rec.push(field); field = ''; }
    else if (c === '\n') { rec.push(field); records.push(rec); rec = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || rec.length) { rec.push(field); records.push(rec); }
  const [header, ...body] = records;
  if (!header) return [];
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** Copies the manual review columns from an existing results.csv onto fresh rows, by runId + toolCallId. */
export function mergeManual(rows: Row[], existingCsv: string): Row[] {
  const old = new Map(parseCsv(existingCsv).map(r => [`${r.runId}\u0000${r.toolCallId}`, r]));
  return rows.map(r => {
    const o = old.get(`${r.runId}\u0000${r.toolCallId}`);
    if (!o) return r;
    const out = { ...r };
    for (const k of MANUAL) (out as Record<string, unknown>)[k] = o[k] ?? '';
    return out;
  });
}
