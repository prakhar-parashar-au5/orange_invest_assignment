// Demo data for the deployed app. Prakhar runs it once from his laptop through Railway's TCP proxy:
//   DATABASE_URL='mysql://…/orange_invest_demo' npm run seed:demo            dry run
//   DATABASE_URL='mysql://…/orange_invest_demo' npm run seed:demo -- --write
// Creates a@test.local and b@test.local with synthetic statements, and admin@test.local with
// role=admin. Idempotent. Refuses any database not ending in _demo. Ends with ANALYZE TABLE so the
// optimizer has fresh statistics after the bulk load.
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { categoriserFromConfig } from '../src/categorise/index.js';
import { describeError } from '../src/util/log-error.js';
import { planPersonas, seedPersonas } from './seed-lib.js';

const ADMIN = 'admin@test.local';
const ANALYZE = ['users', 'uploads', 'transactions', 'merchant_categories'];

const config = loadConfig(process.env);
const dbName = new URL(config.databaseUrl).pathname.slice(1);
if (!/_demo$/.test(dbName)) {
  console.error(`seed:demo only writes to a database ending in _demo, not ${dbName}`);
  process.exit(1);
}
const write = process.argv.includes('--write');

const db = createPool(config.databaseUrl);
try {
  const plan = await planPersonas(db);
  console.log(`${dbName}${write ? '' : ' (dry run; pass --write)'}:`);
  for (const p of plan) console.log(`  ${p.email}: ${p.existingUploadId ? `already has ${p.filename}` : `will ingest ${p.filename}`}`);
  const [admins] = await db.query("SELECT 1 FROM users WHERE email = ? AND role = 'admin'", [ADMIN]);
  console.log(`  ${ADMIN}: ${admins.length ? 'already an admin' : 'will be created as admin'}`);
  console.log(`  OpenAI fallback for unknown merchants: ${config.openaiApiKey ? 'on' : 'off (run recategorise later with a key)'}`);

  if (write) {
    await seedPersonas({ db, categoriser: categoriserFromConfig({ config, db }), plan });
    await db.query("INSERT INTO users (email, role) VALUES (?, 'admin') ON DUPLICATE KEY UPDATE role = 'admin'", [ADMIN]);
    console.log(`${ADMIN} is an admin`);
    for (const t of ANALYZE) await db.query(`ANALYZE TABLE ${t}`);
    console.log(`analyzed ${ANALYZE.join(', ')}`);
  }
} catch (err) {
  console.error(`seed:demo failed: ${describeError(err)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
