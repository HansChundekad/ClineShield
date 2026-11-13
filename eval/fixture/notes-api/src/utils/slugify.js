import { normalizeWhitespace } from './strings.js';

/** "Hello, World!" -> "hello-world" */
export function slugify(title) {
  return normalizeWhitespace(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
