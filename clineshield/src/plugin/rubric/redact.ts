/**
 * redact.ts
 *
 * Replaces secrets (the same SECRET_PATTERNS the secret_added check uses) with
 * a placeholder. Used before code leaves the machine (Gemini explanations) and
 * before diffs are written to the diff sidecar. Pure, never throws.
 */

import { SECRET_PATTERNS } from './checks/hard';

export const REDACTED = '[REDACTED]';

const GLOBAL_PATTERNS = SECRET_PATTERNS.map(p => new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`));

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of GLOBAL_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}
