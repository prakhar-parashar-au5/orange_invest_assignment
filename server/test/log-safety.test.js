// BE-008: provider error text (OpenAI's 401 echoes a masked key) never reaches the logs.
import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import { testApp, testConfig, loggedInAgent } from './helpers.js';
import { createPool } from '../src/db.js';
import { createCategoriser } from '../src/categorise/index.js';
import { describeError } from '../src/util/log-error.js';
import { errorHandler } from '../src/http/errors.js';

const leaky = () =>
  Object.assign(new Error('401 Incorrect API key provided: sk-ab...wxyz. You can find your API key at …'), {
    name: 'AuthenticationError',
    status: 401,
    code: 'invalid_api_key',
  });
const clean = (text) => {
  expect(text).not.toContain('sk-ab');
  expect(text).not.toContain('wxyz');
  expect(text).not.toMatch(/\bkey\b/i);
};

const closers = [];
afterAll(async () => {
  for (const c of closers) await c();
});

describe('provider errors in logs', () => {
  it('describeError keeps only class, status and code', () => {
    const d = describeError(leaky());
    expect(d).toBe('AuthenticationError status=401 code=invalid_api_key');
    clean(d);
  });

  it('chat agent failure log has no provider message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = testApp({ agent: { reply: async () => Promise.reject(leaky()) } });
    closers.push(ctx.close);
    const { agent } = await loggedInAgent(ctx.app, 'leak');
    const conv = await agent.post('/api/conversations').send({});

    const res = await agent.post(`/api/conversations/${conv.body.conversation.id}/messages`).send({ text: 'hi' });

    expect(res.status).toBe(502);
    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('status=401');
    clean(logged);
    warn.mockRestore();
  });

  it('categoriser LLM-failure warning has no provider message', async () => {
    const db = createPool(testConfig().databaseUrl);
    closers.push(() => db.end());
    const logger = { warn: vi.fn() };
    const categoriser = createCategoriser({ db, classifier: { classify: async () => Promise.reject(leaky()) }, logger });

    await categoriser.categorise([{ merchant: 'Zqx Leak Traders', description: 'x', direction: 'debit', channel: 'UPI' }]);

    const logged = logger.warn.mock.calls.flat().join('\n');
    expect(logged).toContain('status=401');
    clean(logged);
  });

  it('the generic 500 handler logs no message either', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = { status: () => res, json: () => res };

    errorHandler(leaky(), request, res, () => {});

    clean(error.mock.calls.flat().join('\n'));
    error.mockRestore();
  });
});
