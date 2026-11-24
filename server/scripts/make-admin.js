// Give a user the admin role (they must have logged in once).
//   npm run make-admin -- --email admin@test.local [--create] [--allow-db <name>]
// --create makes the user first if it doesn't exist. Refuses any DB not ending in _dev, _test or
// _demo unless --allow-db names it.
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { describeError } from '../src/util/log-error.js';
import { checkDbName } from './db-guard.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const email = arg('email')?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('usage: npm run make-admin -- --email <e> [--create] [--allow-db <name>]');
  process.exit(1);
}

const config = loadConfig(process.env);
const dbName = checkDbName(config.databaseUrl, arg('allow-db'));
const db = createPool(config.databaseUrl);
try {
  if (process.argv.includes('--create')) {
    await db.query('INSERT INTO users (email) VALUES (?) ON DUPLICATE KEY UPDATE id = id', [email]);
  }
  const [r] = await db.query("UPDATE users SET role = 'admin' WHERE email = ?", [email]);
  if (r.affectedRows === 0) {
    console.error(`no user ${email} in ${dbName}; log in once first, or pass --create`);
    process.exitCode = 1;
  } else {
    console.log(`${email} is an admin in ${dbName}`);
  }
} catch (err) {
  console.error(`make-admin failed: ${describeError(err)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
