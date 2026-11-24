// All runtime config, from env vars. There is no .env file in v1: locally the defaults below point at
// the disposable Docker MySQL from scripts/db-up.sh, and in production every secret must be set or
// startup fails.

import { fileURLToPath } from 'node:url';

const LOCAL_DB_HOST = '127.0.0.1:3306';
// server/ → ../client/dist, where the root build puts the React app
const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));
const intEnv = (v, fallback) => (v !== undefined && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : fallback);
const LOCAL_APP_USER = 'orange_app:orange_app_dev';
// Dev-only. Production refuses to start without a real JWT_SECRET.
const LOCAL_JWT_SECRET = 'orange-invest-local-dev-only-jwt-secret';

const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'JWT_SECRET', 'OPENAI_API_KEY', 'ADMIN_LOGIN_CODE'];

/**
 * @param {Record<string, string | undefined>} env usually process.env
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  if (isProduction) {
    const missing = REQUIRED_IN_PRODUCTION.filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new Error(`Missing required env vars in production: ${missing.join(', ')}`);
    }
  }

  const localDbName = nodeEnv === 'test' ? 'orange_invest_test' : 'orange_invest_dev';

  return {
    nodeEnv,
    port: Number(env.PORT) || 4101,
    // Production is one origin (Express serves the client), so CORS stays off unless CLIENT_ORIGIN is set.
    clientOrigin: env.CLIENT_ORIGIN || (isProduction ? null : 'http://localhost:5181'),
    serveClient: isProduction || Boolean(env.CLIENT_DIST_DIR),
    clientDistDir: env.CLIENT_DIST_DIR || DEFAULT_CLIENT_DIST,
    limits: {
      chatPerWindow: intEnv(env.CHAT_RATE_LIMIT, 20),
      chatWindowMs: intEnv(env.CHAT_RATE_WINDOW_SECONDS, 600) * 1000,
      uploadsPerDay: intEnv(env.UPLOADS_PER_DAY, 20),
    },
    databaseUrl: env.DATABASE_URL || `mysql://${LOCAL_APP_USER}@${LOCAL_DB_HOST}/${localDbName}`,
    jwtSecret: env.JWT_SECRET || LOCAL_JWT_SECRET,
    cookieSecure: isProduction,
    openaiApiKey: env.OPENAI_API_KEY || null,
    openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
    logLevel: env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
    // Dummy email login means anyone could type an admin's email. In production an admin login also
    // needs this code. Unset → admins can't log in at all (fail closed); normal users are unaffected.
    adminCodeRequired: isProduction,
    adminLoginCode: env.ADMIN_LOGIN_CODE || null,
  };
}
