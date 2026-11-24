import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { testApp, uniqueEmail } from './helpers.js';
import { CATEGORIES } from '../src/categories.js';

let ctx;
beforeAll(() => {
  ctx = testApp();
});
afterAll(() => ctx.close());

describe('GET /api/categories', () => {
  it('needs a login', async () => {
    const res = await request(ctx.app).get('/api/categories');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the fixed list in order, with is_spend false only for Self-transfer and Investments', async () => {
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/login').send({ email: uniqueEmail('cats') });

    const res = await agent.get('/api/categories');

    expect(res.status).toBe(200);
    expect(res.body.categories.map((c) => c.name)).toEqual([...CATEGORIES]);
    const nonSpend = res.body.categories.filter((c) => !c.is_spend).map((c) => c.name);
    expect(nonSpend).toEqual(['Investments', 'Self-transfer']);
  });
});
