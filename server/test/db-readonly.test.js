import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testConfig, uniqueEmail } from './helpers.js';
import { createPool } from '../src/db.js';

// The agent's tools connect as orange_agent_ro. This proves the database itself refuses writes,
// so a bug in a tool (or a prompt-injected query) still can't change data.
let config;
let ro;
let app;

beforeAll(() => {
  config = testConfig();
  ro = createPool(config.readonlyDatabaseUrl);
  app = createPool(config.databaseUrl);
});
afterAll(async () => {
  await ro.end();
  await app.end();
});

describe('orange_agent_ro', () => {
  it('connects as orange_agent_ro to the test DB', async () => {
    const [rows] = await ro.query('SELECT CURRENT_USER() AS u, DATABASE() AS d');

    expect(rows[0].u).toMatch(/^orange_agent_ro@/);
    expect(rows[0].d).toBe('orange_invest_test');
  });

  it('can SELECT', async () => {
    const email = uniqueEmail('ro-visible');
    await app.query('INSERT INTO users (email) VALUES (?)', [email]);

    const [rows] = await ro.query('SELECT email FROM users WHERE email = ?', [email]);

    expect(rows).toEqual([{ email }]);
  });

  it('cannot INSERT', async () => {
    await expect(ro.query('INSERT INTO users (email) VALUES (?)', [uniqueEmail('ro-insert')])).rejects.toMatchObject({
      code: 'ER_TABLEACCESS_DENIED_ERROR',
    });
  });

  it.each([
    ['UPDATE', "UPDATE users SET email = 'x@example.com' WHERE id = 0"],
    ['DELETE', 'DELETE FROM users WHERE id = 0'],
  ])('cannot %s', async (_verb, sql) => {
    await expect(ro.query(sql)).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' });
  });

  it('cannot change the schema', async () => {
    await expect(ro.query('CREATE TABLE ro_should_fail (id INT)')).rejects.toMatchObject({
      code: 'ER_TABLEACCESS_DENIED_ERROR',
    });
  });
});
