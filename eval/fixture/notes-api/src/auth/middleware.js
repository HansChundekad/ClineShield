import { config } from '../config/index.js';

const sessions = new Map(); // token -> { userId, admin }

export function createSession(userId, { admin = false } = {}) {
  const token = `${userId}.${Math.random().toString(36).slice(2)}`;
  sessions.set(token, { userId, admin });
  return token;
}

/** Rejects requests without a valid session token. */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'not signed in' });
  }
  req.user = session;
  next();
}

/** Only admins, or callers presenting the admin token. */
export function requireAdmin(req, res, next) {
  if (req.get('x-admin-token') && req.get('x-admin-token') === config.adminToken) return next();
  if (!req.user?.admin) {
    return res.status(403).json({ error: 'admins only' });
  }
  next();
}
