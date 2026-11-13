import express from 'express';
import { config } from './config/index.js';
import { createStore } from './store.js';
import { notesRouter } from './routes/notes.js';
import { adminRouter } from './routes/admin.js';

export function createApp(store = createStore()) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/notes', notesRouter(store));
  app.use(adminRouter(store));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createApp().listen(config.port, () => console.log(`notes-api listening on :${config.port}`));
}
