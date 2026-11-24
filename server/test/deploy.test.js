// BE-011: one-service production shape (static client + API), rate limits, and db:create safety.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createRateLimiter } from '../src/http/rate-limit.js';
import { planDbCreate } from '../scripts/db-create.js';
import { testApp, loggedInAgent } from './helpers.js';

const PROD_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://a:b@h:1/orange_invest_demo',
  JWT_SECRET: 's',
  OPENAI_API_KEY: 'k',
  ADMIN_LOGIN_CODE: 'c',
};

describe('production config', () => {
  it('CORS is off without CLIENT_ORIGIN, the client is served, and the dist dir defaults next to server/', () => {
    const c = loadConfig(PROD_ENV);
    expect(c.clientOrigin).toBeNull();
    expect(c.serveClient).toBe(true);
    expect(c.clientDistDir).toMatch(/client[/\\]dist$/);
    expect(loadConfig({}).serveClient).toBe(false);
  });
});

describe('static client with SPA fallback', () => {
  let dir;
  let app;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'oi-dist-'));
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root">orange</div>');
    writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    app = createApp({ config: { ...loadConfig(PROD_ENV), clientDistDir: dir }, db: null, agent: null });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serves index.html at / and for client routes, and hashed assets with a long cache', async () => {
    const root = await request(app).get('/');
    const deep = await request(app).get('/uploads/12');
    const asset = await request(app).get('/assets/app-abc123.js');

    expect(root.status).toBe(200);
    expect(root.text).toContain('orange');
    expect(root.headers['cache-control']).toMatch(/no-cache/);
    expect(deep.status).toBe(200);
    expect(deep.text).toContain('orange');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toMatch(/immutable/);
  });

  it('keeps /api 404s as JSON, a missing asset as 404, and the API working', async () => {
    const api404 = await request(app).get('/api/nope');
    const missing = await request(app).get('/assets/missing.js');
    const health = await request(app).get('/api/health');
    const post = await request(app).post('/some/page');

    expect(api404.status).toBe(404);
    expect(api404.body.error.code).toBe('NOT_FOUND');
    expect(missing.status).toBe(404);
    expect(health.body).toEqual({ status: 'ok' });
    expect(post.status).toBe(404);
  });

  it('sends no CORS headers in production without CLIENT_ORIGIN', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limits', () => {
  it('the limiter allows N requests per window per key, then says when to retry', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect([limiter.take(1), limiter.take(1), limiter.take(2)].map((r) => r.ok)).toEqual([true, true, true]);
    expect(limiter.take(1)).toEqual({ ok: false, retryAfterSeconds: 1 });
    t = 1001;
    expect(limiter.take(1).ok).toBe(true);
  });

  it('chat: 429 RATE_LIMITED after the per-user limit, other users unaffected', async () => {
    const ctx = testApp({ agent: { model: 'm', reply: async () => ({ content: 'ok', toolCalls: [], rounds: 0 }) }, limits: { chatPerWindow: 2, chatWindowMs: 60000 } });
    try {
      const a = await loggedInAgent(ctx.app, 'rl-a');
      const b = await loggedInAgent(ctx.app, 'rl-b');
      const conv = (await a.agent.post('/api/conversations').send({})).body.conversation.id;
      const convB = (await b.agent.post('/api/conversations').send({})).body.conversation.id;
      const send = (who, id) => who.agent.post(`/api/conversations/${id}/messages`).send({ text: 'hi' });

      const codes = [(await send(a, conv)).status, (await send(a, conv)).status];
      const third = await send(a, conv);
      const other = await send(b, convB);

      expect(codes).toEqual([201, 201]);
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('RATE_LIMITED');
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      expect(other.status).toBe(201);
    } finally {
      await ctx.close();
    }
  });

  it('uploads: 429 RATE_LIMITED after the daily cap', async () => {
    const ctx = testApp({ limits: { uploadsPerDay: 1 } });
    try {
      const { agent } = await loggedInAgent(ctx.app, 'rl-up');
      const csv = Buffer.from('Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/10/26,POS X SHOP,,01/10/26,1.00,,1.00\n');
      const up = () => agent.post('/api/uploads').attach('file', csv, { filename: 's.csv', contentType: 'text/csv' });

      expect((await up()).status).toBe(201);
      const second = await up();
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await ctx.close();
    }
  });
});

describe('db:create', () => {
  const urls = (db) => ({ databaseUrl: `mysql://root:s3cr%40t-pw@h:3306/${db}` });

  it.each([['orange_invest_demo'], ['railway'], ['a_1']])('accepts the database name %s', (db) => {
    expect(() => planDbCreate(urls(db))).not.toThrow();
  });

  it.each([['orange-invest'], ['Orange'], ['x;DROP DATABASE y'], ['a'.repeat(65)], [''], ['%E0%A4%A']])('rejects the database name %o', (db) => {
    expect(() => planDbCreate(urls(db))).toThrow(/database name/);
  });

  it('only creates the database: no users, no grants, and no secret in the SQL or the log line', () => {
    const plan = planDbCreate(urls('orange_invest_demo'));
    const sql = plan.statements.map((s) => s.sql).join('\n');

    expect(plan.statements).toHaveLength(1);
    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS `orange_invest_demo`');
    expect(sql).not.toMatch(/USER|GRANT/);
    expect(JSON.stringify(plan)).not.toContain('s3cr');
  });
});
