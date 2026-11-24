import jwt from 'jsonwebtoken';
import { unauthenticated, HttpError } from '../http/errors.js';

export const SESSION_COOKIE = 'oi_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  };
}

export function setSessionCookie(res, config, userId) {
  const token = jwt.sign({}, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(userId),
    expiresIn: SESSION_SECONDS,
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(config), maxAge: SESSION_SECONDS * 1000 });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(config));
}

/**
 * Middleware: verifies the session cookie and sets req.userId. The user id only ever comes from the
 * signed token, never from the body, the query or the LLM.
 */
export function requireUser(config) {
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next(unauthenticated());
    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      const userId = Number(payload.sub);
      if (!Number.isSafeInteger(userId) || userId <= 0) return next(unauthenticated());
      req.userId = userId;
      return next();
    } catch {
      return next(unauthenticated('Session expired or invalid, please log in again'));
    }
  };
}

/**
 * Middleware: a logged-in admin. The role is re-read from the DB on every request, so revoking
 * admin takes effect immediately. Non-admins get 403 FORBIDDEN.
 */
export function requireAdmin(config, db) {
  const user = requireUser(config);
  return (req, res, next) =>
    user(req, res, async (err) => {
      if (err) return next(err);
      try {
        const [rows] = await db.query('SELECT role FROM users WHERE id = ?', [req.userId]);
        if (rows.length === 0) return next(unauthenticated());
        if (rows[0].role !== 'admin') return next(new HttpError(403, 'FORBIDDEN', 'Admins only'));
        return next();
      } catch (e) {
        return next(e);
      }
    });
}
