// Writes one AI trace of each shape, for building and testing the admin dashboard (FE-003):
//   no tool · one tool · several tools · rejected arg then retry · failed tool · provider 401 ·
//   in progress · reviewed · two-turn conversation
// The rows go through the real recorder (src/agent/recorder.js); no fake model runs in the app.
// They belong to trace-fixtures@test.local, one conversation per shape, titled "[fixture] <shape>".
//
//   npm run fixtures:traces            dry run: lists what it would write
//   npm run fixtures:traces -- --write
// Idempotent: a shape whose conversation already exists is skipped. Refuses DB names not ending in
// _dev, _test or _demo.
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createRecorder } from '../src/agent/recorder.js';
import { describeError } from '../src/util/log-error.js';
import { checkDbName } from './db-guard.js';

const EMAIL = 'trace-fixtures@test.local';
const MODEL = 'gpt-4.1-mini';
const total = (paise, inr) => ({ total: { paise, inr }, txn_count: 12 });

// Each step is { model: {...} } or { tool: {...} }, in timeline order.
const SHAPES = [
  {
    name: 'no tool',
    turns: [{ q: 'Hi, what can you do?', a: 'I can answer questions about your own transactions.', steps: [{ model: { finishReason: 'stop', tin: 900, tout: 25 } }] }],
  },
  {
    name: 'one tool',
    turns: [
      {
        q: 'How much did I spend in October?',
        a: 'You spent ₹1,25,078.73 in October 2026.',
        steps: [
          { model: { finishReason: 'tool_calls', requested: 1, tin: 1480, tout: 40 } },
          { tool: { name: 'spend_summary', args: { period: 'month_name:october' }, result: total(12507873, '₹1,25,078.73') } },
          { model: { finishReason: 'stop', tin: 1640, tout: 60 } },
        ],
      },
    ],
  },
  {
    name: 'several tools',
    turns: [
      {
        q: 'Why was last month higher than the month before?',
        a: 'October was ₹48,049.38 higher than September, mostly Travel (+₹42,475.42).',
        steps: [
          { model: { finishReason: 'tool_calls', requested: 2, tin: 1500, tout: 70 } },
          { tool: { name: 'compare_periods', args: { a: 'last_month', b: 'months_ago:2' }, result: { difference: { paise: 4804938, inr: '₹48,049.38' } } } },
          { tool: { name: 'top_merchants', args: { period: 'last_month', n: 3 }, result: { merchants: [{ merchant: 'Makemytrip', total: { paise: 2450000 } }] } } },
          { model: { finishReason: 'stop', tin: 2100, tout: 120 } },
        ],
      },
    ],
  },
  {
    name: 'rejected tool arg',
    turns: [
      {
        q: 'How much next month?',
        a: "I can only look at money you've already spent. This month so far is ₹23,410.00.",
        steps: [
          { model: { finishReason: 'tool_calls', requested: 1, tin: 1400, tout: 30 } },
          { tool: { name: 'spend_summary', args: { period: 'next_month' }, rejected: "period: Invalid period 'next_month': unknown period" } },
          { model: { finishReason: 'tool_calls', requested: 1, tin: 1550, tout: 30 } },
          { tool: { name: 'spend_summary', args: { period: 'this_month' }, result: total(2341000, '₹23,410.00') } },
          { model: { finishReason: 'stop', tin: 1700, tout: 50 } },
        ],
      },
    ],
  },
  {
    name: 'failed tool',
    failure: { stage: 'tool', errorClass: 'Error' },
    turns: [
      {
        q: 'Top merchants this year?',
        a: null,
        steps: [
          { model: { finishReason: 'tool_calls', requested: 1, tin: 1450, tout: 30 } },
          { tool: { name: 'top_merchants', args: { period: 'this_year' }, failed: 'Error' } },
        ],
      },
    ],
  },
  {
    name: 'provider 401',
    failure: { stage: 'model', errorClass: 'AuthenticationError', status: 401 },
    turns: [{ q: 'How much on food?', a: null, steps: [{ model: { failed: { name: 'AuthenticationError', status: 401 } } }] }],
  },
  {
    name: 'in progress',
    inProgress: true,
    turns: [{ q: 'What are my subscriptions?', a: null, steps: [{ model: { inProgress: true } }] }],
  },
  {
    name: 'reviewed',
    review: { verdict: 'needs_fix', note: "Used last_30_days for 'last month'; should be last_month." },
    turns: [
      {
        q: 'How much did I spend last month?',
        a: 'You spent ₹1,04,220.00 in the last 30 days.',
        steps: [
          { model: { finishReason: 'tool_calls', requested: 1, tin: 1400, tout: 35 } },
          { tool: { name: 'spend_summary', args: { period: 'last_30_days' }, result: total(10422000, '₹1,04,220.00') } },
          { model: { finishReason: 'stop', tin: 1600, tout: 45 } },
        ],
      },
    ],
  },
  {
    name: 'two-turn conversation',
    turns: [
      {
        q: 'How much on food delivery last month?',
        a: 'You spent ₹6,520.11 on food delivery in October 2026.',
        steps: [
          { model: { finishReason: 'tool_calls', requested: 1, tin: 1450, tout: 40 } },
          { tool: { name: 'spend_summary', args: { period: 'last_month', category: 'Food delivery' }, result: total(652011, '₹6,520.11') } },
          { model: { finishReason: 'stop', tin: 1600, tout: 40 } },
        ],
      },
      {
        q: 'And the month before?',
        a: 'In September 2026 you spent ₹5,980.40 on food delivery.',
        steps: [
          { model: { finishReason: 'tool_calls', requested: 1, tin: 1700, tout: 40 } },
          { tool: { name: 'spend_summary', args: { period: 'months_ago:2', category: 'Food delivery' }, result: total(598040, '₹5,980.40') } },
          { model: { finishReason: 'stop', tin: 1850, tout: 40 } },
        ],
      },
    ],
  },
];

async function writeShape(db, recorder, userId, shape) {
  const [c] = await db.query('INSERT INTO conversations (user_id, title) VALUES (?, ?)', [userId, `[fixture] ${shape.name}`]);
  let reviewedTraceId = null;
  for (const turn of shape.turns) {
    const [um] = await db.query("INSERT INTO messages (conversation_id, user_id, role, content) VALUES (?, ?, 'user', ?)", [c.insertId, userId, turn.q]);
    const traceId = await recorder.startTrace({ userId, conversationId: c.insertId, userMessageId: um.insertId, model: MODEL });
    let seq = 0;
    let round = 0;
    let tin = 0;
    let tout = 0;
    for (const step of turn.steps) {
      seq += 1;
      if (step.model) {
        const m = step.model;
        const id = await recorder.startModelCall(traceId, { seq, model: MODEL });
        if (m.inProgress) continue;
        if (m.failed) {
          await recorder.finishModelCall(id, { status: 'FAILED', latencyMs: 310, err: m.failed });
          continue;
        }
        tin += m.tin;
        tout += m.tout;
        await recorder.finishModelCall(id, {
          status: 'SUCCEEDED',
          tokensIn: m.tin,
          tokensOut: m.tout,
          latencyMs: 700 + m.tout * 10,
          finishReason: m.finishReason,
          requestedTools: m.requested ?? 0,
        });
        if (m.finishReason === 'tool_calls') round += 1;
      } else {
        const t = step.tool;
        const id = await recorder.startToolCall(traceId, { seq, round, name: t.name, args: t.args });
        if (t.failed) await recorder.finishToolCall(id, { status: 'FAILED', validationStatus: 'OK', latencyMs: 15, error: t.failed });
        else if (t.rejected) {
          await recorder.finishToolCall(id, { status: 'REJECTED', validationStatus: 'REJECTED', result: { error: t.rejected }, latencyMs: 1, error: t.rejected });
        } else await recorder.finishToolCall(id, { status: 'SUCCEEDED', validationStatus: 'OK', result: t.result, latencyMs: 12 });
      }
    }
    if (shape.inProgress) continue;
    const latencyMs = 1200 + tout * 12;
    if (shape.failure) {
      const err = { name: shape.failure.errorClass, status: shape.failure.status };
      await recorder.finishTrace(traceId, { status: 'FAILED', errorStage: shape.failure.stage, err, rounds: round, tokensIn: tin, tokensOut: tout, latencyMs });
      continue;
    }
    const [am] = await db.query("INSERT INTO messages (conversation_id, user_id, role, content, tool_calls_json) VALUES (?, ?, 'assistant', ?, '[]')", [
      c.insertId,
      userId,
      turn.a,
    ]);
    await recorder.finishTrace(traceId, { status: 'SUCCEEDED', rounds: round, tokensIn: tin, tokensOut: tout, latencyMs, assistantMessageId: am.insertId });
    reviewedTraceId = traceId;
  }
  if (shape.review && reviewedTraceId) {
    await db.query('INSERT INTO ai_trace_reviews (trace_id, verdict, note, reviewer_id, version) VALUES (?, ?, ?, NULL, 1)', [
      reviewedTraceId,
      shape.review.verdict,
      shape.review.note,
    ]);
  }
}

const allowIndex = process.argv.indexOf('--allow-db');
const config = loadConfig(process.env);
const dbName = checkDbName(config.databaseUrl, allowIndex === -1 ? undefined : process.argv[allowIndex + 1]);
const write = process.argv.includes('--write');
const db = createPool(config.databaseUrl);
const recorder = createRecorder({ db });
try {
  const [users] = await db.query('SELECT id FROM users WHERE email = ?', [EMAIL]);
  const [existing] = users.length
    ? await db.query("SELECT title FROM conversations WHERE user_id = ? AND title LIKE '[fixture] %'", [users[0].id])
    : [[]];
  const have = new Set(existing.map((r) => r.title));
  const todo = SHAPES.filter((s) => !have.has(`[fixture] ${s.name}`));

  console.log(`${dbName}: ${SHAPES.length - todo.length} fixture shapes already present, ${todo.length} to write${write ? '' : ' (dry run; pass --write)'}`);
  for (const s of todo) console.log(`  - ${s.name} (${s.turns.length} turn${s.turns.length > 1 ? 's' : ''})`);
  if (write && todo.length > 0) {
    await db.query('INSERT INTO users (email) VALUES (?) ON DUPLICATE KEY UPDATE id = id', [EMAIL]);
    const [[u]] = await db.query('SELECT id FROM users WHERE email = ?', [EMAIL]);
    for (const s of todo) await writeShape(db, recorder, u.id, s);
  }
  console.log(`wrote ${write ? todo.length : 0} shape(s)`);
} catch (err) {
  console.error(`fixtures:traces failed: ${describeError(err)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
