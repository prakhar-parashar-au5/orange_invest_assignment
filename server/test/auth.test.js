import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { testApp, uniqueEmail } from './helpers.js';

let ctx;
beforeAll(() => {
  ctx = testApp();
});
afterAll(() => ctx.close());

function sessionCookie(res) {
  const cookies = res.headers['set-cookie'] ?? [];
  return cookies.find((c) => c.startsWith('oi_session='));
}

describe('POST /api/auth/login', () => {
  it('creates a new user and returns it', async () => {
    const email = uniqueEmail('new');

    const res = await request(ctx.app).post('/api/auth/login').send({ email });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email });
    expect(Number.isInteger(res.body.user.id)).toBe(true);
    expect(res.body.user.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/);

    const [rows] = await ctx.db.query('SELECT id FROM users WHERE email = ?', [email]);
    expect(rows).toHaveLength(1);
  });

  it('reuses the same user on a second login, ignoring case and surrounding spaces', async () => {
    const email = uniqueEmail('again');

    const first = await request(ctx.app).post('/api/auth/login').send({ email });
    const second = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: `  ${email.toUpperCase()} ` });

    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.email).toBe(email);
    const [rows] = await ctx.db.query('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email]);
    expect(rows[0].n).toBe(1);
  });

  it('sets an httpOnly, SameSite=Lax session cookie (not Secure outside production)', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ email: uniqueEmail('cookie') });

    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=604800/);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it.each([
    ['missing', {}],
    ['not a string', { email: 42 }],
    ['not an email', { email: 'not-an-email' }],
    ['empty', { email: '   ' }],
    ['too long', { email: `${'a'.repeat(250)}@example.com` }],
  ])('rejects an email that is %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const res = await request(ctx.app).post('/api/auth/login').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('rejects malformed JSON with 400 VALIDATION_ERROR', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 UNAUTHENTICATED without the cookie', async () => {
    const res = await request(ctx.app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
  });

  it('returns 401 with a tampered cookie', async () => {
    const res = await request(ctx.app).get('/api/auth/me').set('Cookie', 'oi_session=not.a.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the logged-in user with the cookie', async () => {
    const agent = request.agent(ctx.app);
    const email = uniqueEmail('me');
    const login = await agent.post('/api/auth/login').send({ email });

    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(login.body.user);
  });

  it('returns 401 when the cookie belongs to a user that no longer exists', async () => {
    const agent = request.agent(ctx.app);
    const login = await agent.post('/api/auth/login').send({ email: uniqueEmail('gone') });
    await ctx.db.query('DELETE FROM users WHERE id = ?', [login.body.user.id]);

    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie so /me is 401 afterwards, and is safe to call twice', async () => {
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/login').send({ email: uniqueEmail('logout') });

    const out = await agent.post('/api/auth/logout');
    const again = await agent.post('/api/auth/logout');
    const me = await agent.get('/api/auth/me');

    expect(out.status).toBe(204);
    expect(sessionCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(again.status).toBe(204);
    expect(me.status).toBe(401);
  });
});
