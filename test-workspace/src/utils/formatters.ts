/**
 * formatters.ts — Pure utility functions
 *
 * CLINESHIELD DEMO: Neutral path, no risk bonus.
 * Good target for safe small edits — PreToolUse allows, PostToolUse sanity passes.
 *
 * Scene 2: add padLeft() here — small safe edit, LOW risk badge.
 * Scene 3: ask Cline to change formatDate() to return number / timestamp.
 *   tsc will fail because formatDateLabel() assigns formatDate() to a string variable.
 */

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]; // e.g. "2024-01-15"
}

// Uses formatDate as a string — tsc fails if formatDate return type becomes number.
export function formatDateLabel(date: Date): string {
  const dateStr: string = formatDate(date);
  return `Updated: ${dateStr}`;
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    amount
  );
}

export function truncate(
  str: string,
  maxLength: number,
  suffix = '...'
): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - suffix.length) + suffix;
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function capitalize(str: string): string {
  if (!str) {
    return str;
  }
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
