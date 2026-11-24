import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './auth/routes.js';
import { requireUser } from './auth/session.js';
import { categoriesForApi } from './categories.js';
import { categoriserFromConfig } from './categorise/index.js';
import { transactionsRouter } from './transactions/routes.js';
import { chatRouter } from './chat/routes.js';
import { adminRouter } from './admin/routes.js';
import { artifactsRouter } from './artifacts/routes.js';
import { agentFromConfig } from './agent/agent.js';
import { notFoundHandler, errorHandler } from './http/errors.js';
import { createRateLimiter, rateLimit } from './http/rate-limit.js';
import { serveClient } from './http/static-client.js';

/** Agent traces (tool names, timings) at debug level only: shown when LOG_LEVEL=debug. */
const debugLogger = (config) => ({
  debug: config.logLevel === 'debug' ? (msg) => console.debug(msg) : () => {},
});

/**
 * Build the Express app. It doesn't listen, so tests can drive it with Supertest.
 * @param {{
 *   config: ReturnType<typeof import('./config.js').loadConfig>,
 *   db: import('mysql2/promise').Pool | null,
 *   dbReadonly?: import('mysql2/promise').Pool | null,
 *   categoriser?: { categorise(rows: object[]): Promise<string[]> },
 *   agent?: ReturnType<typeof import('./agent/agent.js').createAgent> | null,
 *   recorder?: ReturnType<typeof import('./agent/recorder.js').createRecorder> | null,  default: the DB recorder
 * }} deps  categoriser and agent default to the real ones (OpenAI only when OPENAI_API_KEY is set)
 */
export function createApp({
  config,
  db,
  dbReadonly = null,
  categoriser = db ? categoriserFromConfig({ config, db }) : null,
  agent = agentFromConfig(config, debugLogger(config)),
  recorder = null,
}) {
  const app = express();

  app.disable('x-powered-by');
  // Railway terminates TLS in front of us; trust its one proxy hop for req.secure and req.ip.
  if (config.nodeEnv === 'production') app.set('trust proxy', 1);
  if (config.clientOrigin) {
    app.use(
      cors({
        // Only send CORS headers for the one allowed origin; other origins get none.
        origin: (origin, callback) => callback(null, origin === config.clientOrigin),
        // Auth is a JWT in an httpOnly cookie, so the browser must send credentials.
        credentials: true,
      }),
    );
  }
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter({ config, db }));

  app.get('/api/categories', requireUser(config), (_req, res) => {
    res.json({ categories: categoriesForApi() });
  });

  const limits = config.limits ?? {};
  const chatLimiter = createRateLimiter({ limit: limits.chatPerWindow ?? 20, windowMs: limits.chatWindowMs ?? 600_000 });
  const uploadLimiter = createRateLimiter({ limit: limits.uploadsPerDay ?? 20, windowMs: 24 * 60 * 60 * 1000 });
  app.use('/api', transactionsRouter({ config, db, categoriser, uploadLimit: rateLimit(uploadLimiter, 'uploads today') }));
  app.use('/api', chatRouter({ config, db, dbReadonly, agent, chatLimit: rateLimit(chatLimiter, 'messages'), ...(recorder ? { recorder } : {}) }));
  app.use('/api', adminRouter({ config, db }));
  app.use('/api', artifactsRouter({ config, ...(config.artifactsDir ? { dir: config.artifactsDir } : {}) }));

  if (config.serveClient) serveClient(app, config.clientDistDir);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
