// Seeds orange_invest_dev with two synthetic users, each with a 14-month statement ending today (IST):
//   a@test.local (seed 1), b@test.local (seed 2)
// Safe to re-run: a file already ingested is skipped. Uses the real categoriser, so unknown
// merchants go to OpenAI when OPENAI_API_KEY is set and become Unidentified otherwise.
//
//   npm run seed:dev
import { loadConfig } from '../src/config.js';
import { describeError } from '../src/util/log-error.js';
import { createPool } from '../src/db.js';
import { categoriserFromConfig } from '../src/categorise/index.js';
import { planPersonas, seedPersonas } from './seed-lib.js';

const config = loadConfig(process.env);
const dbName = new URL(config.databaseUrl).pathname.slice(1);
if (dbName !== 'orange_invest_dev') {
  console.error(`seed:dev only writes to orange_invest_dev, not ${dbName}`);
  process.exit(1);
}

const db = createPool(config.databaseUrl);
try {
  await seedPersonas({ db, categoriser: categoriserFromConfig({ config, db }), plan: await planPersonas(db) });
} catch (err) {
  console.error(`seed:dev failed: ${describeError(err)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
