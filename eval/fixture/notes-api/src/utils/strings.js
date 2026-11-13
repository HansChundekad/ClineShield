export function normalizeWhitespace(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

export function truncate(s, max = 80) {
  const t = normalizeWhitespace(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
