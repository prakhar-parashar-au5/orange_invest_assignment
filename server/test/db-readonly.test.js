import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testConfig, uniqueEmail } from './helpers.js';
import { createPool, createReadOnlyPool } from '../src/db.js';

// The agent's tools use a pool whose every session is READ ONLY (same DATABASE_URL, same user as the
// app). This proves MySQL itself refuses writes on it, so a bug in a tool, or a prompt-injected
// query, still can't change data.
let config;
let ro;
let app;

beforeAll(() => {
  config = testConfig();
  ro = createReadOnlyPool(config.databaseUrl);
  app = createPool(config.databaseUrl);
});
afterAll(async () => {
  await ro.end();
  await app.end();
});

const READ_ONLY = { code: 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION' };

describe('the read-only agent pool', () => {
  it('uses the same database and user as the app, with a read-only session', async () => {
    const [[r]] = await ro.query('SELECT DATABASE() AS d, CURRENT_USER() AS u, @@session.transaction_read_only AS ro');
    const [[a]] = await app.query('SELECT CURRENT_USER() AS u, @@session.transaction_read_only AS ro');

    expect(r.d).toBe('orange_invest_test');
    expect(r.u).toBe(a.u);
    expect(r.ro).toBe(1);
    expect(a.ro).toBe(0); // the shared app pool is never switched
  });

  it('can SELECT', async () => {
    const email = uniqueEmail('ro-visible');
    await app.query('INSERT INTO users (email) VALUES (?)', [email]);

    const [rows] = await ro.query('SELECT email FROM users WHERE email = ?', [email]);

    expect(rows).toEqual([{ email }]);
  });

  it.each([
    ['INSERT', () => ro.query('INSERT INTO users (email) VALUES (?)', [uniqueEmail('ro-insert')])],
    ['UPDATE', () => ro.query("UPDATE users SET email = 'x@example.com' WHERE id = 0")],
    ['DELETE', () => ro.query('DELETE FROM users WHERE id = 0')],
    ['CREATE TABLE', () => ro.query('CREATE TABLE ro_should_fail (id INT)')],
  ])('cannot %s', async (_verb, write) => {
    await expect(write()).rejects.toMatchObject(READ_ONLY);
  });

  it('a fresh connection taken after the pool was created is read-only too (applied on connect)', async () => {
    // Hold every existing connection so the pool has to open a new one.
    const held = await Promise.all(Array.from({ length: 3 }, () => ro.getConnection()));
    const fresh = await ro.getConnection();
    try {
      const [[{ id }]] = await fresh.query('SELECT CONNECTION_ID() AS id');
      expect(held.map((c) => c.threadId)).not.toContain(id);
      const [[{ flag }]] = await fresh.query('SELECT @@session.transaction_read_only AS flag');
      expect(flag).toBe(1);
      await expect(fresh.query('DELETE FROM users WHERE id = 0')).rejects.toMatchObject(READ_ONLY);
    } finally {
      fresh.release();
      held.forEach((c) => c.release());
    }
  });
});
