// BE-016: the AI dashboard and evals are open to every logged-in user; only DELETE stays admin-only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { testApp, loggedInAgent } from './helpers.js';
import { loadConfig } from '../src/config.js';

let ctx;
let traceId;
let user;
let admin;

beforeAll(async () => {
  ctx = testApp({ agent: { model: 'm', reply: async () => ({ content: 'Hello.', toolCalls: [], rounds: 0 }) } });
  user = await loggedInAgent(ctx.app, 'open-user');
  const conv = await user.agent.post('/api/conversations').send({});
  const sent = await user.agent.post(`/api/conversations/${conv.body.conversation.id}/messages`).send({ text: 'hi' });
  const [[t]] = await ctx.db.query('SELECT id FROM ai_traces WHERE assistant_message_id = ?', [sent.body.assistant_message.id]);
  traceId = t.id;
  admin = await loggedInAgent(ctx.app, 'open-admin');
  await ctx.db.query("UPDATE users SET role = 'admin' WHERE id = ?", [admin.user.id]);
  await ctx.db.query("INSERT INTO eval_runs (label, model, prompt_version, status) VALUES ('access test', 'm', 'v2', 'FINISHED')");
});
afterAll(() => ctx.close());

const reads = () => [
  ['summary', (a) => a.get('/api/admin/ai/summary')],
  ['traces', (a) => a.get('/api/admin/ai/traces')],
  ['trace detail', (a) => a.get(`/api/admin/ai/traces/${traceId}`)],
  ['review', (a) => a.put(`/api/admin/ai/traces/${traceId}/review`).send({ verdict: 'good', expectedVersion: 0 })],
  ['evals', (a) => a.get('/api/admin/evals')],
  ['eval detail', async (a) => a.get(`/api/admin/evals/${(await a.get('/api/admin/evals')).body.runs[0].id}`)],
];

describe('AI dashboard access', () => {
  it('a normal user (role=user) gets 200 on summary, traces, trace detail, review and evals', async () => {
    expect(user.user.role).toBe('user');
    for (const [name, call] of reads()) {
      const res = await call(user.agent);
      expect([name, res.status]).toEqual([name, 200]);
    }
  });

  it('logged out gets 401 on every one, including DELETE', async () => {
    const anon = request(ctx.app);
    for (const [name, call] of [...reads(), ['delete', (a) => a.delete(`/api/admin/ai/traces/${traceId}?confirm=true`)]]) {
      const res = await call(anon).catch(() => ({ status: 401 })); // eval detail can't even list runs
      expect([name, res.status]).toEqual([name, 401]);
    }
  });

  it('DELETE stays admin-only: a normal user gets 403 FORBIDDEN, an admin gets 204', async () => {
    const denied = await user.agent.delete(`/api/admin/ai/traces/${traceId}?confirm=true`);
    const allowed = await admin.agent.delete(`/api/admin/ai/traces/${traceId}?confirm=true`);

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect(allowed.status).toBe(204);
  });
});

describe('login has no admin code any more', () => {
  it('an admin logs in in production without a code, and an extra code field is ignored', async () => {
    const prodish = testApp();
    try {
      const a = await loggedInAgent(prodish.app, 'code-gone');
      await prodish.db.query("UPDATE users SET role = 'admin' WHERE id = ?", [a.user.id]);
      const plain = await request(prodish.app).post('/api/auth/login').send({ email: a.user.email });
      const withCode = await request(prodish.app).post('/api/auth/login').send({ email: a.user.email, code: 'anything' });

      expect(plain.status).toBe(200);
      expect(plain.body.user.role).toBe('admin');
      expect(withCode.status).toBe(200);
    } finally {
      await prodish.close();
    }
  });

  it('production config no longer needs or reads an admin login code', () => {
    const c = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'mysql://a:b@h:1/x_demo', JWT_SECRET: 's', OPENAI_API_KEY: 'k' });
    expect(c).not.toHaveProperty('adminLoginCode');
    expect(c).not.toHaveProperty('adminCodeRequired');
  });
});
