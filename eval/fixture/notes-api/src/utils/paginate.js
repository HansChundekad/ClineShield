/**
 * Returns one page of items. Pages start at 1.
 * paginate([a, b, c, d], 2, 2) -> [c, d]
 */
export function paginate(items, page = 1, size = 20) {
  const start = (page - 1) * size;
  const end = start + size - 1;
  return items.slice(start, end);
}

export function pageCount(total, size = 20) {
  return Math.max(1, Math.ceil(total / size));
}
