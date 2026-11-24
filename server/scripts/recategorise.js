// Re-categorise rows stored as Unidentified, e.g. after uploading without an OpenAI key.
//
//   OPENAI_API_KEY=… npm run recategorise -- --email you@example.com
//   npm run recategorise -- --user-id 7
//   npm run recategorise -- --all
//   … --allow-db <name>   to run against a database other than orange_invest_dev
//
// Without a key it still applies the rules and the merchant cache, and says so.
import { loadConfig } from '../src/config.js';
import { describeError } from '../src/util/log-error.js';
import { createPool } from '../src/db.js';
import { createCategoriser } from '../src/categorise/index.js';
import { createOpenAiClassifier } from '../src/categorise/openai-classifier.js';
import { recategoriseUser } from '../src/categorise/recategorise.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? '');
};
const has = (name) => process.argv.includes(`--${name}`);
const usage = () => {
  console.error('usage: npm run recategorise -- (--email <e> | --user-id <id> | --all) [--allow-db <name>]');
  process.exit(1);
};

const email = arg('email');
const userIdArg = arg('user-id');
const all = has('all');
if ([email !== undefined, userIdArg !== undefined, all].filter(Boolean).length !== 1) usage();
if (userIdArg !== undefined && !/^\d+$/.test(userIdArg)) usage();

const config = loadConfig(process.env);
const dbName = new URL(config.databaseUrl).pathname.slice(1);
const allowed = arg('allow-db');
if (dbName !== 'orange_invest_dev' && dbName !== allowed) {
  console.error(`refusing to run against ${dbName}: only orange_invest_dev, unless you pass --allow-db ${dbName}`);
  process.exit(1);
}

// Count OpenAI calls by wrapping the normal classifier.
let llmCalls = 0;
const openai = createOpenAiClassifier({ apiKey: config.openaiApiKey, model: config.openaiModel });
const classifier = openai && {
  classify: (names) => {
    llmCalls += Math.ceil(names.length / 100); // the classifier batches 100 names per request
    return openai.classify(names);
  },
};

const db = createPool(config.databaseUrl);
const categoriser = createCategoriser({ db, classifier, logger: { warn: (m) => console.warn(m) } });
try {
  let users;
  if (all) [users] = await db.query('SELECT id, email FROM users ORDER BY id');
  else if (email !== undefined) [users] = await db.query('SELECT id, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  else [users] = await db.query('SELECT id, email FROM users WHERE id = ?', [Number(userIdArg)]);
  if (users.length === 0) {
    console.error('no such user');
    process.exitCode = 1;
  }

  console.log(`database ${dbName}; ${classifier ? `OpenAI ${config.openaiModel}` : 'no OPENAI_API_KEY: rules and cache only, unknown merchants stay Unidentified'}`);
  const totals = { looked: 0, changed: 0, stillUnidentified: 0 };
  for (const u of users) {
    const r = await recategoriseUser({ db, categoriser, userId: u.id });
    for (const k of Object.keys(totals)) totals[k] += r[k];
    if (r.looked > 0 || !all) {
      console.log(`${u.email} (user ${u.id}): Unidentified before ${r.looked}, changed ${r.changed}, still Unidentified ${r.stillUnidentified}`);
    }
  }
  if (users.length > 1) {
    console.log(`total: Unidentified before ${totals.looked}, changed ${totals.changed}, still Unidentified ${totals.stillUnidentified}`);
  }
  console.log(`OpenAI calls: ${llmCalls}`);
} catch (err) {
  console.error(`recategorise failed: ${describeError(err)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
