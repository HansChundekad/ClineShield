/** Nearest-rank percentile: the value at rank ceil(p/100 * n) of the sorted values. null for no values. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1];
}

export function stats(values: number[]): { n: number; median: number | null; p95: number | null } {
  return { n: values.length, median: percentile(values, 50), p95: percentile(values, 95) };
}

const TIMING = /^\[ClineShield\] timing tool=\S+ id=(\S+) ms=(\d+(?:\.\d+)?) tier=\S+$/;

/** toolCallId -> ms from the plugin's opt-in timing lines. */
export function parseTimingLines(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const m = TIMING.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}
