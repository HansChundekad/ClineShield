import express from 'express';
import { requireAuth } from '../auth/middleware.js';
import { paginate, pageCount } from '../utils/paginate.js';
import { truncate } from '../utils/strings.js';

const MAX_TITLE = 120;
const MAX_BODY = 10_000;

function validateNote(input) {
  const errors = [];
  if (typeof input?.title !== 'string' || !input.title.trim()) errors.push('title is required');
  else if (input.title.length > MAX_TITLE) errors.push(`title must be at most ${MAX_TITLE} characters`);
  if (input?.body !== undefined && typeof input.body !== 'string') errors.push('body must be a string');
  else if ((input?.body ?? '').length > MAX_BODY) errors.push(`body must be at most ${MAX_BODY} characters`);
  if (input?.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(t => typeof t !== 'string'))) errors.push('tags must be a list of strings');
  return errors;
}

export function notesRouter(store) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const page = Number(req.query.page ?? 1);
    const size = Number(req.query.size ?? 20);
    const all = store.list();
    res.json({
      page,
      pages: pageCount(all.length, size),
      notes: paginate(all, page, size).map(n => ({ ...n, preview: truncate(n.body) })),
    });
  });

  router.post('/', express.json(), (req, res) => {
    const errors = validateNote(req.body);
    if (errors.length) return res.status(400).json({ errors });
    res.status(201).json(store.add(req.body));
  });

  router.delete('/:id', (req, res) => {
    const ok = store.remove(Number(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  return router;
}
