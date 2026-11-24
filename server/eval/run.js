// npm run eval -- --base-url http://localhost:4100 [--repeat-high 3] [--label "text"]
//
// Talks to a running server over HTTP, as the seeded personas (a@test.local, b@test.local). Reads
// traces and the oracle's data straight from the database that server uses (DATABASE_URL, by
// default the local orange_invest_dev), through a read-only session. The server needs OPENAI_API_KEY;
// without it the run stops as BLOCKED.
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { createPool, createReadOnlyPool } from '../src/db.js';
import { PROMPT_VERSION } from '../src/agent/recorder.js';
import { describeError } from '../src/util/log-error.js';
import { runEval } from './runner.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const baseUrl = arg('base-url');
const repeatHigh = Number(arg('repeat-high', '3'));
if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !Number.isInteger(repeatHigh) || repeatHigh < 1 || repeatHigh > 10) {
  console.error('usage: npm run eval -- --base-url <http://host:port> [--repeat-high 3] [--label <text>]');
  process.exit(1);
}

/** A cookie-carrying HTTP client per persona. */
const client = {
  async session(email) {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!login.ok) throw Object.assign(new Error('persona login failed'), { name: 'EvalLoginFailed', status: login.status });
    const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('oi_session='));
    const call = async (method, path, body) => {
      const r = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    return {
      newConversation: async () => (await call('POST', '/api/conversations', {})).body.conversation.id,
      send: (id, text) => call('POST', `/api/conversations/${id}/messages`, { text }),
    };
  },
};

const config = loadConfig(process.env);
const db = createPool(config.databaseUrl);
const readDb = createReadOnlyPool(config.databaseUrl);
try {
  const corpus = JSON.parse(await readFile(new URL('./corpus.json', import.meta.url), 'utf8'));
  const result = await runEval({
    corpus,
    client,
    db,
    readDb,
    model: config.openaiModel,
    promptVersion: PROMPT_VERSION,
    label: arg('label', null),
    repeatHigh,
    log: (line) => console.log(line),
  });
  if (result.status === 'BLOCKED') {
    console.log('BLOCKED: the server answered AGENT_UNAVAILABLE. Start it with OPENAI_API_KEY and run again.');
    process.exitCode = 2;
  } else if (result.cases.some((c) => c.verdict !== 'pass')) {
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`eval failed: ${describeError(err)}`);
  process.exitCode = 1;
} finally {
  await db.end();
  await readDb.end();
}
