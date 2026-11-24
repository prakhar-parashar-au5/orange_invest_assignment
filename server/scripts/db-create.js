// Pre-deploy step 1 of 2 (then db:init). Safe on every deploy:
//   - CREATE DATABASE IF NOT EXISTS for the database named in DATABASE_URL
//   - create or update the read-only user from DATABASE_READONLY_URL (password from the URL) with
//     SELECT on that one database only, then check it holds nothing more
// Connects as the DATABASE_URL user (on Railway, MySQL's root) without selecting a database.
// Never prints a URL or a password.
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';
import { describeError } from '../src/util/log-error.js';

const NAME = /^[a-z0-9_]{1,64}$/;

/**
 * Validates both URLs and returns the statements to run. Identifiers are validated, then quoted;
 * the password is a bound parameter, never part of the SQL text.
 * @returns {{ database: string, roUser: string, statements: { sql: string, params?: string[] }[], describe: string[] }}
 */
export function planDbCreate({ databaseUrl, readonlyUrl }) {
  const app = new URL(databaseUrl);
  const ro = new URL(readonlyUrl);
  const decode = (v, what) => {
    try {
      return decodeURIComponent(v);
    } catch {
      throw new Error(`${what} is not valid URL encoding`);
    }
  };
  const database = decode(app.pathname.slice(1), 'DATABASE_URL: the database name');
  const roDatabase = decode(ro.pathname.slice(1), 'DATABASE_READONLY_URL: the database name');
  const roUser = decode(ro.username, 'DATABASE_READONLY_URL: the read-only user name');
  const roPassword = decode(ro.password, 'DATABASE_READONLY_URL: the password');
  if (!NAME.test(database)) throw new Error('DATABASE_URL: the database name must match ^[a-z0-9_]{1,64}$');
  if (roDatabase !== database) throw new Error('DATABASE_READONLY_URL must point at the same database as DATABASE_URL');
  if (!NAME.test(roUser)) throw new Error('DATABASE_READONLY_URL: the read-only user name must match ^[a-z0-9_]{1,64}$');
  if (roPassword.length < 12) throw new Error('DATABASE_READONLY_URL: the read-only password must be at least 12 characters');

  const user = `'${roUser}'@'%'`;
  return {
    database,
    roUser,
    statements: [
      { sql: `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci` },
      { sql: `CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY ?`, params: [roPassword] },
      { sql: `ALTER USER ${user} IDENTIFIED BY ?`, params: [roPassword] },
      { sql: `GRANT SELECT ON \`${database}\`.* TO ${user}` },
    ],
    describe: [`database ${database}`, `read-only user ${roUser}: SELECT on ${database}.* only`],
  };
}

/** Throws if the read-only user holds anything beyond USAGE and SELECT on this database. */
export async function assertReadOnly(conn, { database, roUser }) {
  const [rows] = await conn.query(`SHOW GRANTS FOR '${roUser}'@'%'`);
  const grants = rows.map((r) => Object.values(r)[0]);
  const extra = grants.filter(
    (g) => !/^GRANT USAGE ON \*\.\* TO /.test(g) && !new RegExp(`^GRANT SELECT ON \`${database}\`\\.\\* TO `).test(g),
  );
  if (extra.length) throw Object.assign(new Error('read-only user has extra grants'), { name: 'ReadOnlyUserHasExtraGrants', extra: extra.length });
  return grants.length;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const config = loadConfig(process.env);
  let conn;
  try {
    const plan = planDbCreate({ databaseUrl: config.databaseUrl, readonlyUrl: config.readonlyDatabaseUrl });
    const admin = new URL(config.databaseUrl);
    admin.pathname = '/';
    conn = await mysql.createConnection({ uri: admin.toString() });
    for (const s of plan.statements) await conn.query(s.sql, s.params ?? []);
    await assertReadOnly(conn, plan);
    console.log(`db:create ok: ${plan.describe.join('; ')}`);
  } catch (err) {
    // Validation errors are ours and safe to print; anything else prints only class and code.
    const safe = err.message?.startsWith('DATABASE_') || err.name === 'ReadOnlyUserHasExtraGrants';
    console.error(`db:create failed: ${safe ? err.message : describeError(err)}`);
    process.exitCode = 1;
  } finally {
    await conn?.end();
  }
}
