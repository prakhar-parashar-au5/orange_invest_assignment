import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createCategoriser } from '../src/categorise/index.js';

/** Config for tests: always the test DB (vitest sets NODE_ENV=test). */
export function testConfig() {
  const config = loadConfig(process.env);
  if (!config.databaseUrl.endsWith('/orange_invest_test')) {
    throw new Error(`Refusing to run tests against ${config.databaseUrl}; tests use orange_invest_test only`);
  }
  return config;
}

/**
 * An app wired to the test DB. The LLM is always off in tests, even if OPENAI_API_KEY is set:
 * categorisation has no classifier, and chat uses only the `agent` passed in (default: none).
 */
export function testApp({ agent = null, recorder = null, limits = {} } = {}) {
  const base = testConfig();
  // Generous limits by default so ordinary tests never hit them.
  const config = { ...base, limits: { chatPerWindow: 1000, chatWindowMs: 600_000, uploadsPerDay: 1000, ...limits } };
  const db = createPool(config.databaseUrl);
  const dbReadonly = createPool(config.readonlyDatabaseUrl);
  const categoriser = createCategoriser({ db, classifier: null, logger: { warn() {} } });
  const app = createApp({ config, db, dbReadonly, categoriser, agent, recorder });
  return {
    app,
    db,
    dbReadonly,
    config,
    close: async () => {
      await db.end();
      await dbReadonly.end();
    },
  };
}

/** A logged-in supertest agent with a fresh user. */
export async function loggedInAgent(app, label = 'user') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: uniqueEmail(label) });
  return { agent, user: res.body.user };
}

/** A unique email per test, so parallel test files never collide on the same user. */
export function uniqueEmail(label = 'user') {
  return `${label}-${randomUUID()}@example.com`;
}
