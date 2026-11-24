// Applies db/schema.sql (idempotent).
//   node scripts/db-init.js               → the DB in DATABASE_URL (default: local orange_invest_dev)
//   node scripts/db-init.js --reset-test  → DROP and recreate orange_invest_test, then apply the schema
//
// The reset only ever touches a database literally named orange_invest_test.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';

const SCHEMA_PATH = fileURLToPath(new URL('../db/schema.sql', import.meta.url));
const TEST_DB = 'orange_invest_test';

// Columns added after a table first shipped. CREATE TABLE IF NOT EXISTS doesn't touch an existing
// table, so each one is added here if missing. Every step is idempotent.
const ADDED_COLUMNS = [
  { table: 'users', column: 'role', ddl: "ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER email" },
];

export async function applySchema(databaseUrl) {
  const sql = await readFile(SCHEMA_PATH, 'utf8');
  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  try {
    await conn.query(sql);
    for (const { table, column, ddl } of ADDED_COLUMNS) {
      const [found] = await conn.query(
        'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column],
      );
      if (found.length === 0) await conn.query(ddl);
    }
    const [tables] = await conn.query('SHOW TABLES');
    return { database: conn.config.database, tables: tables.map((t) => Object.values(t)[0]) };
  } finally {
    await conn.end();
  }
}

export async function resetTestDb() {
  const { databaseUrl } = loadConfig({ ...process.env, NODE_ENV: 'test' });
  const url = new URL(databaseUrl);
  if (url.pathname !== `/${TEST_DB}`) {
    throw new Error(`refusing to reset ${url.pathname.slice(1)}: only ${TEST_DB} may be reset`);
  }
  url.pathname = '/';
  const conn = await mysql.createConnection({ uri: url.toString() });
  try {
    await conn.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await conn.query(`CREATE DATABASE ${TEST_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await conn.end();
  }
  return applySchema(databaseUrl);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const reset = process.argv.includes('--reset-test');
  try {
    const result = reset ? await resetTestDb() : await applySchema(loadConfig(process.env).databaseUrl);
    console.log(`${reset ? 'reset and applied' : 'applied'} schema to ${result.database}: ${result.tables.join(', ')}`);
  } catch (err) {
    console.error(`db-init failed: ${err.code ?? ''} ${err.message}`);
    process.exit(1);
  }
}
