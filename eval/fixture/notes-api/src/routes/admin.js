import express from 'express';
import { requireAuth, requireAdmin } from '../auth/middleware.js';

export function adminRouter(store) {
  const router = express.Router();

  router.get('/admin/stats', requireAuth, requireAdmin, (req, res) => {
    const notes = store.list();
    const tags = new Set(notes.flatMap(n => n.tags));
    res.json({ notes: notes.length, tags: tags.size, uptimeSeconds: Math.round(process.uptime()) });
  });

  return router;
}
