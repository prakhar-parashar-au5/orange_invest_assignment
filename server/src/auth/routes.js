import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { badRequest, unauthenticated } from '../http/errors.js';
import { toIstIso } from '../util/time.js';
import { setSessionCookie, clearSessionCookie, requireUser } from './session.js';

const MAX_EMAIL_LENGTH = 254;
// Deliberately simple: one @, no spaces, a dot in the domain. Login is dummy, so this only has to
// stop obvious typos and junk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmail(body) {
  const raw = body?.email;
  if (typeof raw !== 'string') throw badRequest('email is required');
  const email = raw.trim().toLowerCase();
  if (email.length === 0) throw badRequest('email is required');
  if (email.length > MAX_EMAIL_LENGTH) throw badRequest(`email must be at most ${MAX_EMAIL_LENGTH} characters`);
  if (!EMAIL_RE.test(email)) throw badRequest('email is not a valid email address');
  return email;
}

const digest = (s) => createHash('sha256').update(String(s)).digest();

/** Constant time: both sides are hashed to 32 bytes first, so the length leaks nothing either. */
export function codeMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

const toUserJson = (row) => ({ id: row.id, email: row.email, role: row.role, created_at: toIstIso(row.created_at) });

/**
 * @param {{ config: object, db: import('mysql2/promise').Pool }} deps
 */
export function authRouter({ config, db }) {
  const router = Router();

  // Dummy login: a new email creates the user; a known email gets the same user back.
  router.post('/login', async (req, res) => {
    const email = parseEmail(req.body);

    // Race-safe upsert: two concurrent first logins for the same email both end with one row.
    await db.query('INSERT INTO users (email) VALUES (?) ON DUPLICATE KEY UPDATE id = id', [email]);
    const [rows] = await db.query('SELECT id, email, role, created_at FROM users WHERE email = ?', [email]);
    if (rows[0].role === 'admin' && config.adminCodeRequired && !codeMatches(req.body?.code, config.adminLoginCode)) {
      throw unauthenticated('Login failed');
    }

    setSessionCookie(res, config, rows[0].id);
    res.json({ user: toUserJson(rows[0]) });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.get('/me', requireUser(config), async (req, res) => {
    const [rows] = await db.query('SELECT id, email, role, created_at FROM users WHERE id = ?', [req.userId]);
    // A valid token for a deleted user (e.g. after a DB reset) is treated as logged out.
    if (rows.length === 0) throw unauthenticated();
    res.json({ user: toUserJson(rows[0]) });
  });

  return router;
}
