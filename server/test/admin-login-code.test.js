// BE-011 addition: in production an admin account also needs ADMIN_LOGIN_CODE to log in.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { testConfig, uniqueEmail } from './helpers.js';
import { codeMatches } from '../src/auth/routes.js';

const base = testConfig();
const db = createPool(base.databaseUrl);
afterAll(() => db.end());

const appWith = (overrides) => createApp({ config: { ...base, ...overrides }, db, agent: null });
const cookieOf = (res) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('oi_session='));

async function adminEmail() {
  const email = uniqueEmail('code-admin');
  await db.query("INSERT INTO users (email, role) VALUES (?, 'admin')", [email]);
  return email;
}

describe('admin login code (production)', () => {
  const prod = { adminCodeRequired: true, adminLoginCode: 'correct-horse-battery' };

  it('an admin needs the right code: missing or wrong → 401 and no cookie; right → 200', async () => {
    const app = appWith(prod);
    const email = await adminEmail();

    const missing = await request(app).post('/api/auth/login').send({ email });
    const wrong = await request(app).post('/api/auth/login').send({ email, code: 'nope' });
    const right = await request(app).post('/api/auth/login').send({ email, code: 'correct-horse-battery' });

    for (const r of [missing, wrong]) {
      expect(r.status).toBe(401);
      expect(r.body.error).toEqual({ code: 'UNAUTHENTICATED', message: 'Login failed' });
      expect(cookieOf(r)).toBeUndefined();
    }
    expect(right.status).toBe(200);
    expect(right.body.user.role).toBe('admin');
    expect(cookieOf(right)).toBeDefined();
  });

  it('normal users are unaffected, and an admin cannot log in at all if no code is configured', async () => {
    const user = await request(appWith(prod)).post('/api/auth/login').send({ email: uniqueEmail('code-user') });
    const noCode = await request(appWith({ adminCodeRequired: true, adminLoginCode: null }))
      .post('/api/auth/login')
      .send({ email: await adminEmail(), code: '' });

    expect(user.status).toBe(200);
    expect(noCode.status).toBe(401);
  });

  it('is off outside production', async () => {
    const res = await request(appWith({ adminCodeRequired: false })).post('/api/auth/login').send({ email: await adminEmail() });
    expect(res.status).toBe(200);
  });

  it('compares in constant time over a fixed-length digest, so length leaks nothing either', () => {
    expect(codeMatches('abc', 'abc')).toBe(true);
    expect(codeMatches('abc', 'abd')).toBe(false);
    expect(codeMatches('a', 'a much longer secret')).toBe(false);
    expect(codeMatches(undefined, 'x')).toBe(false);
    expect(codeMatches('x', null)).toBe(false);
  });

  it('config: required in production, read from ADMIN_LOGIN_CODE', async () => {
    const { loadConfig } = await import('../src/config.js');
    const c = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://a:b@h:1/x_demo',
      JWT_SECRET: 's',
      OPENAI_API_KEY: 'k',
      ADMIN_LOGIN_CODE: 'zzz',
    });
    expect(c).toMatchObject({ adminCodeRequired: true, adminLoginCode: 'zzz' });
    expect(loadConfig({}).adminCodeRequired).toBe(false);
  });
});
