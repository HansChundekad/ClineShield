/**
 * Runtime mirror of src/types/metrics.ts for tests: metrics.ts only has
 * compile-time types, and events read back from disk are untyped JSON.
 * Returns a list of problems; empty means the event matches the schema.
 */
export function validateEvent(event: unknown): string[] {
  const problems: string[] = [];
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    return ['event is not an object'];
  }
  const e = event as Record<string, unknown>;
  if (typeof e.timestamp !== 'string' || Number.isNaN(Date.parse(e.timestamp))) {
    problems.push('timestamp is not an ISO 8601 string');
  }
  if (typeof e.sessionId !== 'string' || e.sessionId.length === 0) {
    problems.push('sessionId is not a non-empty string');
  }
  if (typeof e.data !== 'object' || e.data === null) {
    return [...problems, 'data is not an object'];
  }
  const d = e.data as Record<string, unknown>;
  const str = (k: string) => typeof d[k] === 'string' || problems.push(`data.${k} is not a string`);
  const num = (k: string) => typeof d[k] === 'number' || problems.push(`data.${k} is not a number`);
  const strArr = (k: string) =>
    (Array.isArray(d[k]) && (d[k] as unknown[]).every(x => typeof x === 'string')) ||
    problems.push(`data.${k} is not a string[]`);
  const optNum = (k: string) => d[k] === undefined || num(k);

  switch (e.type) {
    case 'edit-blocked':
      str('file'); str('reason'); num('structuralChangePercent'); num('functionsDeleted'); num('exportsDeleted');
      break;
    case 'edit-allowed':
      str('file'); num('structuralChangePercent'); num('functionsDeleted'); num('exportsDeleted');
      break;
    case 'sanity-failed':
      str('file'); str('tool'); strArr('errors'); num('retryCount'); num('maxRetries');
      break;
    case 'sanity-passed':
      str('file'); strArr('tools'); optNum('duration');
      break;
    case 'risk-assessed':
      str('file'); num('rulesScore');
      if (!['low', 'medium', 'high'].includes(d.level as string)) problems.push('data.level is not low|medium|high');
      if (!Array.isArray(d.reasons)) problems.push('data.reasons is not an array');
      break;
    case 'llm-analysis':
      str('file'); str('relatedRiskEventTimestamp'); str('reasoning');
      break;
    default:
      problems.push(`unknown type ${String(e.type)}`);
  }
  return problems;
}
