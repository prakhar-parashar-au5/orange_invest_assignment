// Pre-deploy step 1 of 2 (then db:init). Safe on every deploy:
//   CREATE DATABASE IF NOT EXISTS for the database named in DATABASE_URL.
// Connects as the DATABASE_URL user (on Railway, MySQL's root) without selecting a database.
// There's no separate read-only user: the agent's pool makes every session READ ONLY (src/db.js).
// Never prints a URL or a password.
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';
import { describeError } from '../src/util/log-error.js';

const NAME = /^[a-z0-9_]{1,64}$/;

/**
 * Validates the database name and returns the statement to run. The name is validated, then quoted.
 * @returns {{ database: string, statements: { sql: string }[], describe: string[] }}
 */
export function planDbCreate({ databaseUrl }) {
  let database;
  try {
    database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error('DATABASE_URL: the database name is not valid URL encoding');
  }
  if (!NAME.test(database)) throw new Error('DATABASE_URL: the database name must match ^[a-z0-9_]{1,64}$');
  return {
    database,
    statements: [{ sql: `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci` }],
    describe: [`database ${database}`],
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const config = loadConfig(process.env);
  let conn;
  try {
    const plan = planDbCreate({ databaseUrl: config.databaseUrl });
    const admin = new URL(config.databaseUrl);
    admin.pathname = '/';
    conn = await mysql.createConnection({ uri: admin.toString() });
    for (const s of plan.statements) await conn.query(s.sql);
    console.log(`db:create ok: ${plan.describe.join('; ')}`);
  } catch (err) {
    // Validation errors are ours and safe to print; anything else prints only class and code.
    const safe = err.message?.startsWith('DATABASE_URL');
    console.error(`db:create failed: ${safe ? err.message : describeError(err)}`);
    process.exitCode = 1;
  } finally {
    await conn?.end();
  }
}
