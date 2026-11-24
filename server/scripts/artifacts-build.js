// Regenerates the data behind docs/artifacts/ from the code and the databases, so the pages can't
// drift from what's built:
//   1. schema.json + an erDiagram   apply schema.sql to orange_invest_test, then read information_schema
//   2. request flow                 check every step's file and symbol exist
//   3. test counts and run times    run the server suite (and the client's, with --client-dir)
//   4. performance                  EXPLAIN + p50/p95 over 50 runs of the main queries on seeded dev data
//   5. evals                        the latest eval run per prompt version, from orange_invest_dev
//
//   npm run artifacts:build [-- --client-dir ../../../orange-frontend-builder-ag/orange-frontend/client] [--skip-tests]
//
// Reads the dev DB with the read-only user (the login and admin requests in step 4 go through the
// app, which only upserts existing users). Writes only to docs/artifacts/.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import moment from 'moment-timezone';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createTools } from '../src/agent/tools.js';
import { applySchema } from './db-init.js';
import { describeError } from '../src/util/log-error.js';

const SERVER = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.resolve(SERVER, '..');
const OUT = path.join(REPO, 'docs', 'artifacts');
const now = () => moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm [IST]');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const clientDir = arg('client-dir') ? path.resolve(process.cwd(), arg('client-dir')) : path.join(REPO, 'client');

async function inject(file, marker, body) {
  const p = path.join(OUT, file);
  const md = await readFile(p, 'utf8');
  const re = new RegExp(`(<!-- generated:${marker} -->)[\\s\\S]*?(<!-- /generated:${marker} -->)`);
  if (!re.test(md)) throw new Error(`marker ${marker} missing in ${file}`);
  await writeFile(p, md.replace(re, `$1\n${body.trim()}\n$2`));
}

// ---------- 1. schema ----------
async function buildSchema() {
  const testUrl = loadConfig({ ...process.env, NODE_ENV: 'test' }).databaseUrl;
  await applySchema(testUrl);
  const db = createPool(testUrl);
  try {
    const [cols] = await db.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS k
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );
    const [fks] = await db.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc
         FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY t, c`,
    );
    const [idx] = await db.query(
      `SELECT TABLE_NAME AS t, INDEX_NAME AS i, NON_UNIQUE AS nu, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() GROUP BY t, i, nu ORDER BY t, i`,
    );
    const tables = [...new Set(cols.map((r) => r.t))].map((t) => ({
      name: t,
      columns: cols
        .filter((r) => r.t === t)
        .map((r) => ({ name: r.c, type: r.type, nullable: r.nullable === 'YES', key: r.k || null })),
      indexes: idx.filter((r) => r.t === t).map((r) => ({ name: r.i, unique: Number(r.nu) === 0, columns: r.cols.split(',') })),
      foreign_keys: fks.filter((r) => r.t === t).map((r) => ({ column: r.c, references: `${r.rt}.${r.rc}` })),
    }));
    const schema = { generated_at: now(), command: 'npm run artifacts:build', source: 'server/db/schema.sql applied to orange_invest_test', tables };
    await writeFile(path.join(OUT, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);

    const fkCols = new Set(fks.map((r) => `${r.t}.${r.c}`));
    const typeWord = (type) => type.replace(/\(.*$/, '').replace(/\s.*$/, '');
    const entities = tables
      .map((t) => {
        const lines = t.columns.map((c) => {
          const marks = [c.key === 'PRI' ? 'PK' : null, fkCols.has(`${t.name}.${c.name}`) ? 'FK' : null, c.key === 'UNI' ? 'UK' : null].filter(Boolean);
          return `    ${typeWord(c.type)} ${c.name}${marks.length ? ` ${marks.join(', ')}` : ''}`;
        });
        return `  ${t.name} {\n${lines.join('\n')}\n  }`;
      })
      .join('\n');
    const rels = fks.map((r) => `  ${r.rt} ||--o{ ${r.t} : "${r.c}"`).join('\n');
    await inject(
      '02-architecture.md',
      'er',
      `_Generated ${schema.generated_at} by \`npm run artifacts:build\`: ${tables.length} tables, ${fks.length} foreign keys._\n\n\`\`\`mermaid\nerDiagram\n${rels}\n${entities}\n\`\`\``,
    );
    return { tables: tables.length, foreignKeys: fks.length };
  } finally {
    await db.end();
  }
}

// ---------- 2. request flow ----------
export function resolveFlowFile(step, { repo = REPO, client = clientDir } = {}) {
  return step.repo === 'client' ? path.join(client, step.file.replace(/^client\//, '')) : path.join(repo, step.file);
}

async function buildFlow() {
  const flow = JSON.parse(await readFile(path.join(OUT, 'request-flow.json'), 'utf8'));
  const rows = [];
  let ok = 0;
  for (const [i, s] of flow.steps.entries()) {
    const file = resolveFlowFile(s);
    const found = existsSync(file) && (await readFile(file, 'utf8')).includes(s.symbol);
    if (found) ok += 1;
    rows.push(`| ${i + 1} | ${s.label} | \`${s.file}\` | \`${s.symbol.replace(/\|/g, '\\|')}\` | ${found ? 'yes' : '**no**'} |`);
  }
  await inject(
    '02-architecture.md',
    'flow',
    `_Checked ${now()}: ${ok}/${flow.steps.length} steps found in code. Tables read: ${flow.tables_read.join(', ')}. Written: ${flow.tables_written.join(', ')}._\n\n| # | step | file | symbol | found |\n|---|---|---|---|---|\n${rows.join('\n')}`,
  );
  return { steps: flow.steps.length, found: ok };
}

// ---------- 3. tests ----------
async function runVitest(cwd, label) {
  const dir = await mkdtemp(path.join(tmpdir(), 'oi-vitest-'));
  const out = path.join(dir, 'r.json');
  const started = Date.now();
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { cwd, stdio: 'ignore' });
  } catch {
    // A failing suite still writes its report; it's counted below.
  }
  const wallMs = Date.now() - started;
  if (!existsSync(out)) throw new Error(`${label}: vitest produced no report`);
  const report = JSON.parse(await readFile(out, 'utf8'));
  await rm(dir, { recursive: true, force: true });
  return { report, wallMs };
}

async function layerOf(file) {
  const src = await readFile(file, 'utf8');
  return /testConfig|testApp|createPool/.test(src) ? 'server integration (MySQL)' : 'server unit';
}

function summarise(files) {
  const tests = files.flatMap((f) => f.assertionResults);
  return {
    files: files.length,
    tests: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
    test_time_ms: Math.round(tests.reduce((s, t) => s + (t.duration ?? 0), 0)),
  };
}

async function buildTests() {
  const layers = [];
  const server = await runVitest(SERVER, 'server');
  const byLayer = new Map();
  for (const f of server.report.testResults) {
    const layer = await layerOf(f.name);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(f);
  }
  for (const name of ['server unit', 'server integration (MySQL)']) {
    layers.push({ layer: name, command: 'cd server && npx vitest run', ...summarise(byLayer.get(name) ?? []) });
  }
  const serverWall = server.wallMs;
  let clientWall = null;
  if (existsSync(path.join(clientDir, 'package.json'))) {
    const client = await runVitest(clientDir, 'client');
    clientWall = client.wallMs;
    layers.push({ layer: 'client', command: 'cd client && npx vitest run', ...summarise(client.report.testResults) });
  } else {
    layers.push({ layer: 'client', command: 'not run: no client/ found (pass --client-dir)', files: 0, tests: 0, passed: 0, failed: 0, test_time_ms: 0 });
  }
  const rows = layers.map((l) => `| ${l.layer} | ${l.files} | ${l.tests} | ${l.passed} | ${l.failed} | ${(l.test_time_ms / 1000).toFixed(2)} s |`);
  await inject(
    '04-quality.md',
    'tests',
    `_Measured ${now()} by \`npm run artifacts:build\`. Wall time (whole run, including startup and database reset): server ${(serverWall / 1000).toFixed(1)} s${clientWall ? `, client ${(clientWall / 1000).toFixed(1)} s` : ''}._\n\n| layer | files | tests | passed | failed | time in tests |\n|---|---|---|---|---|---|\n${rows.join('\n')}`,
  );
  return { layers, wall_ms: { server: serverWall, client: clientWall } };
}

// ---------- 4. performance ----------
function capturing(pool) {
  const seen = [];
  return {
    seen,
    pool: {
      query: (sql, params) => {
        seen.push({ sql, params });
        return pool.query(sql, params);
      },
      getConnection: () => pool.getConnection(),
    },
  };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function explainAll(ro, statements) {
  const out = [];
  for (const { sql, params } of statements) {
    if (!/^\s*SELECT/i.test(sql)) continue;
    const [rows] = await ro.query(`EXPLAIN ${sql}`, params);
    for (const r of rows) out.push({ table: r.table, type: r.type, key: r.key, rows: Number(r.rows) });
  }
  // One line per table: the access that reads the most rows.
  const worst = new Map();
  for (const e of out) if (!worst.has(e.table) || worst.get(e.table).rows < e.rows) worst.set(e.table, e);
  return [...worst.values()].filter((e) => e.table);
}

async function buildPerf() {
  const config = loadConfig({ ...process.env, NODE_ENV: 'development' });
  const ro = createPool(config.readonlyDatabaseUrl);
  const appDb = createPool(config.databaseUrl);
  try {
    const [[a]] = await ro.query("SELECT id FROM users WHERE email = 'a@test.local'");
    if (!a) return { skipped: 'a@test.local not seeded on orange_invest_dev (run npm run seed:dev)' };
    const [[{ n }]] = await ro.query('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?', [a.id]);

    const results = [];
    const measure = async (label, run, statementsOf) => {
      const times = [];
      for (let i = 0; i < 50; i += 1) {
        const t = process.hrtime.bigint();
        await run();
        times.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
      times.sort((x, y) => x - y);
      const explain = await explainAll(ro, statementsOf());
      results.push({ query: label, runs: 50, p50_ms: Number(pct(times, 50).toFixed(2)), p95_ms: Number(pct(times, 95).toFixed(2)), explain });
    };

    const toolCase = async (label, name, args) => {
      const cap = capturing(ro);
      const tools = createTools({ db: cap.pool, userId: a.id });
      await measure(label, () => tools.run(name, args), () => cap.seen.slice(-10));
    };
    await toolCase('spend_summary by category, this year', 'spend_summary', { period: 'this_year', group_by: 'category' });
    await toolCase('list_transactions, last 30 days', 'list_transactions', { period: 'last_30_days', limit: 50 });
    await toolCase('top_merchants, this year', 'top_merchants', { period: 'this_year', n: 5 });

    // HTTP routes go through the real app; the capture shows their SQL for EXPLAIN.
    const cap = capturing(appDb);
    const app = createApp({ config: { ...config, limits: { chatPerWindow: 1e6, chatWindowMs: 1, uploadsPerDay: 1e6 } }, db: cap.pool, dbReadonly: ro, agent: null, categoriser: { categorise: async () => [] } });
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/login').send({ email: 'a@test.local' });
    await measure('uploads list (GET /api/uploads)', () => userAgent.get('/api/uploads'), () => cap.seen.filter((s) => /FROM uploads/.test(s.sql)).slice(-1));
    const admin = request.agent(app);
    const login = await admin.post('/api/auth/login').send({ email: 'admin@test.local' });
    if (login.body.user?.role === 'admin') {
      await measure('trace summary (GET /api/admin/ai/summary?window=7d)', () => admin.get('/api/admin/ai/summary?window=7d'), () =>
        cap.seen.filter((s) => /ai_traces|ai_tool_calls/.test(s.sql)).slice(-8),
      );
    }
    const [[{ traces }]] = await ro.query('SELECT COUNT(*) AS traces FROM ai_traces');

    const rows = results.map(
      (r) =>
        `| ${r.query} | ${r.p50_ms} | ${r.p95_ms} | ${r.explain.map((e) => `${e.table}: ${e.key ?? '**none**'} (${e.type}, ~${e.rows} rows)`).join('; ')} |`,
    );
    await inject(
      '04-quality.md',
      'perf',
      `_Measured ${now()} by \`npm run artifacts:build\` on orange_invest_dev: ${n} transactions for a@test.local, ${traces} traces in total. Local Docker MySQL on a laptop, so treat these as relative, not production, numbers._\n\n| query | p50 ms | p95 ms | EXPLAIN: index used per table (access type, estimated rows) |\n|---|---|---|---|\n${rows.join('\n')}`,
    );
    return { user_transactions: Number(n), traces: Number(traces), results };
  } finally {
    await ro.end();
    await appDb.end();
  }
}

// ---------- 5. evals ----------
async function buildEvals() {
  const ro = createPool(loadConfig({ ...process.env, NODE_ENV: 'development' }).readonlyDatabaseUrl);
  try {
    const [runs] = await ro.query(
      `SELECT r.* FROM eval_runs r
         JOIN (SELECT prompt_version, MAX(id) AS id FROM eval_runs GROUP BY prompt_version) latest ON latest.id = r.id
        ORDER BY r.prompt_version`,
    );
    const out = runs.map((r) => ({
      id: r.id,
      prompt_version: r.prompt_version,
      model: r.model,
      status: r.status,
      label: r.label,
      started_at: moment(r.started_at).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm [IST]'),
      cases_total: r.cases_total,
      cases_passed: r.cases_passed,
      cases_failed: r.cases_failed,
      cases_blocked: r.cases_blocked,
    }));
    const body = out.length
      ? `| prompt | run | status | model | passed | failed | blocked | of | started |\n|---|---|---|---|---|---|---|---|---|\n${out
          .map((r) => `| ${r.prompt_version} | ${r.id} | ${r.status} | ${r.model} | ${r.cases_passed} | ${r.cases_failed} | ${r.cases_blocked} | ${r.cases_total} | ${r.started_at} |`)
          .join('\n')}`
      : 'No eval runs yet.';
    const live = out.some((r) => r.status === 'FINISHED');
    await inject(
      '04-quality.md',
      'evals',
      `_Read ${now()} from orange_invest_dev by \`npm run artifacts:build\`._\n\n${body}\n\n${
        live
          ? ''
          : '**No live graded run yet.** The only stored run is BLOCKED: the server had no OpenAI key, so nothing was graded. The live run (`npm run eval -- --base-url <url>`) needs the key and is run by Prakhar or the tester.'
      }`,
    );
    return out;
  } finally {
    await ro.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const schema = await buildSchema();
    console.log(`schema: ${schema.tables} tables, ${schema.foreignKeys} foreign keys → docs/artifacts/schema.json, 02-architecture.md`);
    const flow = await buildFlow();
    console.log(`request flow: ${flow.found}/${flow.steps} steps found in code`);
    const tests = process.argv.includes('--skip-tests') ? null : await buildTests();
    if (tests) for (const l of tests.layers) console.log(`tests: ${l.layer}: ${l.passed}/${l.tests} passed in ${l.files} files`);
    const perf = await buildPerf();
    console.log(perf.skipped ? `perf: skipped (${perf.skipped})` : `perf: ${perf.results.length} queries measured`);
    const evals = await buildEvals();
    console.log(`evals: ${evals.length} prompt version(s): ${evals.map((e) => `${e.prompt_version} run ${e.id} ${e.status}`).join(', ') || 'none'}`);
    const quality = { generated_at: now(), command: 'npm run artifacts:build', tests, performance: perf, evals, request_flow: flow };
    await writeFile(path.join(OUT, 'quality.json'), `${JSON.stringify(quality, null, 2)}\n`);
    console.log('wrote docs/artifacts/quality.json');
  } catch (err) {
    console.error(`artifacts:build failed: ${describeError(err)} ${err.message?.startsWith('marker') ? err.message : ''}`);
    process.exitCode = 1;
  }
}
