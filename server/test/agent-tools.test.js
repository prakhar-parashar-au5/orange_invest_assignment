// Every tool result is checked against an independent, hand-written SQL query on a fixed synthetic
// dataset: generator seed 1 (user A) and seed 2 (user B), 14 months ending 2026-11-24, with "now"
// pinned to 2026-11-24 12:00 IST. The checks spell out literal dates and categories on purpose, so
// they don't reuse the code under test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import moment from 'moment-timezone';
import { testConfig, uniqueEmail } from './helpers.js';
import { createPool, createReadOnlyPool } from '../src/db.js';
import { createCategoriser } from '../src/categorise/index.js';
import { ingestStatement } from '../src/ingest/ingest.js';
import { generateStatement } from '../scripts/gen-statement.js';
import { readFileSync } from 'node:fs';
import { createTools, TOOL_DEFINITIONS } from '../src/agent/tools.js';

const NOW = moment.tz('2026-11-24T12:00:00', 'Asia/Kolkata');
const END = '2026-11-24';
const SPEND = "direction = 'debit' AND category NOT IN ('Self-transfer', 'Investments')";

let db;
let ro;
let A;
let B;
let C;
let toolsA;
let toolsB;
let toolsC;

async function makeUser(label, seed) {
  const [u] = await db.query('INSERT INTO users (email) VALUES (?)', [uniqueEmail(label)]);
  if (seed) {
    const categoriser = createCategoriser({ db, classifier: null, logger: { warn() {} } });
    const buffer = Buffer.from(generateStatement({ seed, months: 14, end: END }));
    await ingestStatement({ db, categoriser, userId: u.insertId, filename: `seed${seed}.csv`, buffer });
  }
  return u.insertId;
}

const one = async (sql, params) => {
  const [[row]] = await db.query(sql, params);
  return Object.values(row).map(Number);
};

beforeAll(async () => {
  const config = testConfig();
  db = createPool(config.databaseUrl);
  ro = createReadOnlyPool(config.databaseUrl);
  A = await makeUser('tools-a', 1);
  B = await makeUser('tools-b', 2);
  C = await makeUser('tools-c', null);
  toolsA = createTools({ db: ro, userId: A, now: NOW });
  toolsB = createTools({ db: ro, userId: B, now: NOW });
  toolsC = createTools({ db: ro, userId: C, now: NOW });
});
afterAll(async () => {
  await ro.end();
  await db.end();
});

describe('tool definitions', () => {
  it('never expose user_id as a parameter', () => {
    expect(JSON.stringify(TOOL_DEFINITIONS)).not.toMatch(/user_?id/i);
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      'spend_summary',
      'list_transactions',
      'top_merchants',
      'compare_periods',
      'recurring_payments',
      'income_summary',
      'monthly_average',
      'aggregate',
    ]);
  });
});

describe('golden questions on seed 1, each tool vs hand-written SQL', () => {
  it('Q1 How much did I spend in October? → spend_summary(month_name:october)', async () => {
    const r = await toolsA.run('spend_summary', { period: 'month_name:october' });
    const [total, cnt] = await one(
      `SELECT COALESCE(SUM(amount_paise),0), COUNT(*) FROM transactions
        WHERE user_id = ? AND txn_date BETWEEN '2026-10-01' AND '2026-10-31' AND ${SPEND}`,
      [A],
    );

    expect(r.period).toEqual({ from: '2026-10-01', to: '2026-10-31', label: 'October 2026' });
    expect(r.total.paise).toBe(total);
    expect(r.txn_count).toBe(cnt);
    expect(total).toBeGreaterThan(0);
    expect(r.total.inr).toMatch(/^₹[\d,]+\.\d{2}$/);
  });

  it('Q2 How much on food delivery last month? → spend_summary(last_month, category)', async () => {
    const r = await toolsA.run('spend_summary', { period: 'last_month', category: 'Food delivery' });
    const [total] = await one(
      `SELECT COALESCE(SUM(amount_paise),0) FROM transactions
        WHERE user_id = ? AND txn_date BETWEEN '2026-10-01' AND '2026-10-31' AND direction = 'debit' AND category = 'Food delivery'`,
      [A],
    );

    expect(r.total.paise).toBe(total);
    expect(total).toBeGreaterThan(0);
  });

  it('Q3 Top 5 merchants this year → top_merchants(this_year, 5)', async () => {
    const r = await toolsA.run('top_merchants', { period: 'this_year', n: 5 });
    const [rows] = await db.query(
      `SELECT merchant, SUM(amount_paise) AS total FROM transactions
        WHERE user_id = ? AND txn_date BETWEEN '2026-01-01' AND '2026-11-24' AND ${SPEND} AND merchant IS NOT NULL
        GROUP BY merchant ORDER BY total DESC, merchant LIMIT 5`,
      [A],
    );

    expect(r.merchants.map((m) => [m.merchant, m.total.paise])).toEqual(rows.map((x) => [x.merchant, Number(x.total)]));
    expect(r.merchants[0].rank).toBe(1);
  });

  it('Q4 What are my recurring payments? → recurring_payments()', async () => {
    const r = await toolsA.run('recurring_payments', {});
    const names = r.recurring.map((x) => x.merchant).sort();

    expect(names).toEqual(['Airtel', 'Bajaj Finance', 'Icici Prudential Mf Sip', 'Netflix.com', 'Spotify', 'Suresh Kumar']);
    // independent check for one of them: Netflix appears every month at the same amount
    const [rows] = await db.query(
      `SELECT COUNT(DISTINCT DATE_FORMAT(txn_date, '%Y-%m')) AS months, MIN(amount_paise) AS lo, MAX(amount_paise) AS hi
         FROM transactions WHERE user_id = ? AND merchant = 'Netflix.com'`,
      [A],
    );
    const netflix = r.recurring.find((x) => x.merchant === 'Netflix.com');
    expect(netflix.months_seen).toBe(Number(rows[0].months));
    expect(netflix.typical_amount.paise).toBe(64900);
    expect(Number(rows[0].lo)).toBe(Number(rows[0].hi));
    // variable spend is not recurring, and self transfers are left out
    expect(names).not.toContain('Swiggy');
    expect(names.some((x) => /self/i.test(x))).toBe(false);
  });

  it('Q5 Why was last month higher than the month before? → compare_periods(last_month, months_ago:2)', async () => {
    const r = await toolsA.run('compare_periods', { a: 'last_month', b: 'months_ago:2' });
    const [oct] = await one(
      `SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE user_id = ? AND txn_date BETWEEN '2026-10-01' AND '2026-10-31' AND ${SPEND}`,
      [A],
    );
    const [sep] = await one(
      `SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE user_id = ? AND txn_date BETWEEN '2026-09-01' AND '2026-09-30' AND ${SPEND}`,
      [A],
    );
    const [travelOct] = await one(
      `SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE user_id = ? AND txn_date BETWEEN '2026-10-01' AND '2026-10-31' AND direction='debit' AND category='Travel'`,
      [A],
    );

    expect(r.a.total.paise).toBe(oct);
    expect(r.b.total.paise).toBe(sep);
    expect(r.difference.paise).toBe(oct - sep);
    expect(r.difference_pct).toBeCloseTo(((oct - sep) / sep) * 100, 1);
    expect(r.by_category[0].category).toBe('Travel');
    expect(r.by_category[0].a.paise).toBe(travelOct);
    const sumDiff = r.by_category.reduce((s, c) => s + c.difference.paise, 0);
    expect(sumDiff).toBe(oct - sep);
  });

  it('Q6 Transactions above ₹5,000 in the last 30 days → list_transactions(last_30_days, min_amount_paise 500001)', async () => {
    const r = await toolsA.run('list_transactions', { period: 'last_30_days', min_amount_paise: 500001, direction: 'debit', limit: 50 });
    const [rows] = await db.query(
      `SELECT txn_date, amount_paise FROM transactions
        WHERE user_id = ? AND txn_date BETWEEN '2026-10-26' AND '2026-11-24' AND direction = 'debit' AND amount_paise > 500000
        ORDER BY txn_date DESC, id DESC`,
      [A],
    );

    expect(r.matching_count).toBe(rows.length);
    expect(r.transactions.map((t) => [t.date, t.amount.paise])).toEqual(rows.map((x) => [x.txn_date, Number(x.amount_paise)]));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(r.transactions[0]).not.toHaveProperty('description');
  });

  it('Q7 How much did I pay Swiggy and Zomato combined? → spend_summary(all_time, merchants)', async () => {
    const r = await toolsA.run('spend_summary', { period: 'all_time', merchants: ['swiggy', 'Zomato'], group_by: 'merchant' });
    const [total] = await one(
      `SELECT COALESCE(SUM(amount_paise),0) FROM transactions
        WHERE user_id = ? AND ${SPEND} AND (merchant LIKE '%Swiggy%' OR merchant LIKE '%Zomato%')`,
      [A],
    );

    expect(r.total.paise).toBe(total);
    expect(r.groups.map((g) => g.key).sort()).toEqual(['Swiggy', 'Zomato']);
    expect(r.groups.reduce((s, g) => s + g.total.paise, 0)).toBe(total);
  });

  it("Q8 What's my average monthly spend? → monthly_average(all_time): complete months only", async () => {
    const r = await toolsA.run('monthly_average', { period: 'all_time' });
    const [sum] = await one(
      `SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE user_id = ? AND txn_date BETWEEN '2025-10-01' AND '2026-10-31' AND ${SPEND}`,
      [A],
    );

    expect(r.months_counted).toBe(13); // Oct 2025 … Oct 2026; November 2026 isn't over
    expect(r.first_month).toBe('2025-10');
    expect(r.last_month).toBe('2026-10');
    expect(r.total.paise).toBe(sum);
    expect(r.average.paise).toBe(Math.round(sum / 13));
  });

  it('Q9 What was my biggest single expense? → list_transactions(all_time, spend_only, amount_desc, limit 1)', async () => {
    const r = await toolsA.run('list_transactions', { period: 'all_time', spend_only: true, sort: 'amount_desc', limit: 1 });
    const [rows] = await db.query(
      `SELECT merchant, amount_paise, txn_date FROM transactions WHERE user_id = ? AND ${SPEND} ORDER BY amount_paise DESC LIMIT 1`,
      [A],
    );

    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ merchant: rows[0].merchant, date: rows[0].txn_date });
    expect(r.transactions[0].amount.paise).toBe(Number(rows[0].amount_paise));
    expect(r.transactions[0].amount.inr).toBe('₹84,990.00');
  });

  it('Q10 How much salary came in this year? → income_summary(this_year, Salary)', async () => {
    const r = await toolsA.run('income_summary', { period: 'this_year', category: 'Salary' });
    const [total, cnt] = await one(
      `SELECT COALESCE(SUM(amount_paise),0), COUNT(*) FROM transactions
        WHERE user_id = ? AND direction = 'credit' AND category = 'Salary' AND txn_date BETWEEN '2026-01-01' AND '2026-11-24'`,
      [A],
    );

    expect(r.total.paise).toBe(total);
    expect(r.txn_count).toBe(cnt);
    expect(cnt).toBe(11);
    expect(r.total.inr).toBe('₹13,75,000.00');
  });

  it('income_summary without a category totals every credit', async () => {
    const r = await toolsA.run('income_summary', { period: 'this_year' });
    const [total] = await one(
      `SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE user_id = ? AND direction='credit' AND txn_date BETWEEN '2026-01-01' AND '2026-11-24'`,
      [A],
    );
    expect(r.total.paise).toBe(total);
  });

  it('spend_summary grouped by month and category add up to the total', async () => {
    const byMonth = await toolsA.run('spend_summary', { period: 'this_year', group_by: 'month' });
    const byCat = await toolsA.run('spend_summary', { period: 'this_year', group_by: 'category' });

    expect(byMonth.groups.map((g) => g.key)).toEqual(Array.from({ length: 11 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`));
    expect(byMonth.groups.reduce((s, g) => s + g.total.paise, 0)).toBe(byMonth.total.paise);
    expect(byCat.groups.reduce((s, g) => s + g.total.paise, 0)).toBe(byCat.total.paise);
    expect(byCat.groups.map((g) => g.key)).not.toContain('Investments');
    expect(byCat.groups.map((g) => g.key)).not.toContain('Self-transfer');
  });
});

describe('isolation: tools only ever see their own user', () => {
  it("user B's results match B's SQL, not A's", async () => {
    const rB = await toolsB.run('spend_summary', { period: 'all_time' });
    const [bTotal] = await one(`SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE user_id = ? AND ${SPEND}`, [B]);
    const [aTotal] = await one(`SELECT COALESCE(SUM(amount_paise),0) FROM transactions WHERE user_id = ? AND ${SPEND}`, [A]);

    expect(rB.total.paise).toBe(bTotal);
    expect(bTotal).not.toBe(aTotal);
  });

  it('a user with no data gets zeros and empty lists from every tool', async () => {
    const results = await Promise.all([
      toolsC.run('spend_summary', { period: 'all_time', group_by: 'merchant' }),
      toolsC.run('list_transactions', { period: 'all_time' }),
      toolsC.run('top_merchants', { period: 'all_time' }),
      toolsC.run('compare_periods', { a: 'last_month', b: 'months_ago:2' }),
      toolsC.run('recurring_payments', {}),
      toolsC.run('income_summary', { period: 'all_time' }),
      toolsC.run('monthly_average', { period: 'all_time' }),
    ]);

    expect(results[0]).toMatchObject({ total: { paise: 0 }, txn_count: 0, groups: [] });
    expect(results[1]).toMatchObject({ matching_count: 0, transactions: [] });
    expect(results[2].merchants).toEqual([]);
    expect(results[3]).toMatchObject({ a: { total: { paise: 0 } }, b: { total: { paise: 0 } }, by_category: [] });
    expect(results[4].recurring).toEqual([]);
    expect(results[5]).toMatchObject({ total: { paise: 0 }, by_category: [] });
    expect(results[6]).toMatchObject({ months_counted: 0, average: null });
  });

  it('a user_id smuggled into the arguments is ignored', async () => {
    const r = await toolsC.run('spend_summary', { period: 'all_time', user_id: A });
    expect(r.total.paise).toBe(0);
  });

  it('refuses to build tools without a session user', () => {
    expect(() => createTools({ db: ro, userId: undefined })).toThrow();
  });

  it('runs on the read-only pool, so a write through it would fail', async () => {
    await expect(ro.query("UPDATE transactions SET category = 'Rent' WHERE id = 0")).rejects.toMatchObject({
      code: 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION',
    });
  });
});

describe('bad input comes back as { error } for the model, never a throw', () => {
  it.each([
    ['spend_summary', { period: 'next_month' }, /period/],
    ['spend_summary', { period: 'this_year', group_by: 'week' }, /group_by/],
    ['spend_summary', { period: 'this_year', category: 'Crypto' }, /category/],
    ['list_transactions', { period: 'this_year', limit: 500 }, /limit/],
    ['list_transactions', { period: 'this_year', min_amount_paise: 12.5 }, /min_amount_paise/],
    ['top_merchants', { period: 'this_year', n: 0 }, /\bn\b/],
    ['compare_periods', { a: 'last_month' }, /\bb\b/],
    ['nope', {}, /unknown tool/],
    ['spend_summary', null, /period/],
  ])('%s %o', async (name, args, re) => {
    const r = await toolsA.run(name, args);
    expect(r.error).toMatch(re);
  });

  it("LIKE wildcards in a merchant name match literally, so '%' doesn't match every merchant", async () => {
    const r = await toolsA.run('spend_summary', { period: 'all_time', merchants: ['%'] });
    expect(r.total.paise).toBe(0);
  });
});

describe('one query builder', () => {
  it('is the only agent module with SQL: no tool writes its own', () => {
    const tools = readFileSync(new URL('../src/agent/tools.js', import.meta.url), 'utf8');
    const query = readFileSync(new URL('../src/agent/query.js', import.meta.url), 'utf8');

    expect(tools).not.toMatch(/\b(SELECT|FROM transactions|WHERE|user_id = \?)\b/);
    expect(tools).not.toMatch(/db\.query/);
    expect(query).toMatch(/const clauses = \['user_id = \?'\]/);
  });
});

describe('spend_summary metric=count', () => {
  it('counts spend transactions per category in October', async () => {
    const r = await toolsA.run('spend_summary', { period: 'month_name:october', metric: 'count', group_by: 'category' });
    const [rows] = await db.query(
      `SELECT category, COUNT(*) AS n FROM transactions
        WHERE user_id = ? AND txn_date BETWEEN '2026-10-01' AND '2026-10-31' AND ${SPEND}
        GROUP BY category ORDER BY n DESC, category`,
      [A],
    );

    expect(r.groups.map((g) => [g.key, g.txn_count])).toEqual(rows.map((x) => [x.category, Number(x.n)]));
    expect(r.groups[0]).not.toHaveProperty('total');
  });
});

describe('presets and aggregate agree', () => {
  const both = (a, b) => Promise.all([toolsA.run(...a), toolsA.run(...b)]);

  it('Q1 October spend', async () => {
    const [preset, agg] = await both(
      ['spend_summary', { period: 'month_name:october' }],
      ['aggregate', { metric: 'sum', period: 'month_name:october', spend_only: true }],
    );
    expect(agg.value).toEqual(preset.total);
    expect(agg.txn_count).toBe(preset.txn_count);
  });

  it('Q2 food delivery last month', async () => {
    const [preset, agg] = await both(
      ['spend_summary', { period: 'last_month', category: 'Food delivery' }],
      ['aggregate', { metric: 'sum', period: 'last_month', spend_only: true, category: 'Food delivery' }],
    );
    expect(agg.value).toEqual(preset.total);
  });

  it('Q3 top 5 merchants this year', async () => {
    const [preset, agg] = await both(
      ['top_merchants', { period: 'this_year', n: 5 }],
      ['aggregate', { metric: 'sum', period: 'this_year', spend_only: true, group_by: 'merchant', order: 'desc', limit: 5 }],
    );
    expect(agg.groups.map((g) => [g.key, g.value.paise])).toEqual(preset.merchants.map((m) => [m.merchant, m.total.paise]));
  });

  it('Q5 last month vs the month before, by category', async () => {
    const [preset, a, b] = await Promise.all([
      toolsA.run('compare_periods', { a: 'last_month', b: 'months_ago:2' }),
      toolsA.run('aggregate', { metric: 'sum', period: 'last_month', spend_only: true, group_by: 'category' }),
      toolsA.run('aggregate', { metric: 'sum', period: 'months_ago:2', spend_only: true, group_by: 'category' }),
    ]);
    const sumOf = (r) => r.groups.reduce((s, g) => s + g.value.paise, 0);
    expect(sumOf(a)).toBe(preset.a.total.paise);
    expect(sumOf(b)).toBe(preset.b.total.paise);
    const travel = (r) => r.groups.find((g) => g.key === 'Travel')?.value.paise ?? 0;
    expect(preset.by_category.find((c) => c.category === 'Travel').difference.paise).toBe(travel(a) - travel(b));
  });

  it('Q7 Swiggy and Zomato combined', async () => {
    const [preset, agg] = await both(
      ['spend_summary', { period: 'all_time', merchants: ['swiggy', 'zomato'] }],
      ['aggregate', { metric: 'sum', period: 'all_time', spend_only: true, merchants: ['swiggy', 'zomato'] }],
    );
    expect(agg.value).toEqual(preset.total);
  });

  it('Q8 monthly totals behind the average', async () => {
    const [preset, agg] = await both(
      ['monthly_average', { period: 'all_time' }],
      ['aggregate', { metric: 'sum', period: 'range:2025-10-01..2026-10-31', spend_only: true, group_by: 'month' }],
    );
    expect(agg.groups.map((g) => [g.key, g.value.paise])).toEqual(preset.months.map((m) => [m.month, m.total.paise]));
  });

  it('Q9 biggest single expense', async () => {
    const [preset, agg] = await both(
      ['list_transactions', { period: 'all_time', spend_only: true, sort: 'amount_desc', limit: 1 }],
      ['aggregate', { metric: 'max', period: 'all_time', spend_only: true }],
    );
    expect(agg.value).toEqual(preset.transactions[0].amount);
  });

  it('Q10 salary this year', async () => {
    const [preset, agg] = await both(
      ['income_summary', { period: 'this_year', category: 'Salary' }],
      ['aggregate', { metric: 'sum', period: 'this_year', direction: 'credit', category: 'Salary' }],
    );
    expect(agg.value).toEqual(preset.total);
    expect(agg.txn_count).toBe(preset.txn_count);
  });
});

describe('aggregate on its own, vs hand-written SQL', () => {
  it('avg per transaction, count and day grouping', async () => {
    const [avg, count, days] = await Promise.all([
      toolsA.run('aggregate', { metric: 'avg', period: 'month:2026-10', category: 'Food delivery', direction: 'debit' }),
      toolsA.run('aggregate', { metric: 'count', period: 'this_week' }),
      toolsA.run('aggregate', { metric: 'sum', period: 'last_7_days', spend_only: true, group_by: 'day' }),
    ]);
    const [avgSql] = await one(
      `SELECT ROUND(AVG(amount_paise)) FROM transactions WHERE user_id = ? AND txn_date BETWEEN '2026-10-01' AND '2026-10-31' AND direction='debit' AND category='Food delivery'`,
      [A],
    );
    const [countSql] = await one(`SELECT COUNT(*) FROM transactions WHERE user_id = ? AND txn_date BETWEEN '2026-11-23' AND '2026-11-24'`, [A]);
    const [dayRows] = await db.query(
      `SELECT DATE_FORMAT(txn_date, '%Y-%m-%d') AS d, SUM(amount_paise) AS t FROM transactions
        WHERE user_id = ? AND txn_date BETWEEN '2026-11-18' AND '2026-11-24' AND ${SPEND} GROUP BY d ORDER BY d`,
      [A],
    );

    expect(avg.value.paise).toBe(avgSql);
    expect(count.value).toBe(countSql);
    expect(days.groups.map((g) => [g.key, g.value.paise])).toEqual(dayRows.map((r) => [r.d, Number(r.t)]));
  });

  it("is scoped to the session user like every other tool", async () => {
    const r = await toolsC.run('aggregate', { metric: 'sum', period: 'all_time', spend_only: true, user_id: A });
    expect(r.value.paise).toBe(0);
  });

  it.each([
    [{ period: 'this_year' }, /metric is required/],
    [{ metric: 'median', period: 'this_year' }, /metric must be one of/],
    [{ metric: 'sum', period: 'this_year' }, /needs spend_only=true or a direction/],
    [{ metric: 'max', period: 'this_year', category: 'Rent' }, /needs spend_only=true or a direction/],
    [{ metric: 'sum', period: 'this_year', spend_only: true, direction: 'credit' }, /already means debits/],
    [{ metric: 'sum', period: 'this_year', spend_only: true, category: 'Investments' }, /never spend/],
    [{ metric: 'sum', period: 'this_year', spend_only: true, category: 'Rent', group_by: 'category' }, /one group/],
    [{ metric: 'sum', period: 'this_year', spend_only: true, limit: 5 }, /only apply with group_by/],
    [{ metric: 'count', period: 'this_year', order: 'asc' }, /only apply with group_by/],
    [{ metric: 'sum', period: 'this_year', spend_only: true, group_by: 'day' }, /at most 92 days/],
    [{ metric: 'sum', period: 'this_year', spend_only: true, group_by: 'week' }, /group_by must be one of/],
    [{ metric: 'sum', period: 'this_year', spend_only: 'yes' }, /spend_only must be true or false/],
    [{ metric: 'sum', period: 'this_year', spend_only: true, group_by: 'merchant', limit: 51 }, /limit/],
    [{ metric: 'sum', period: 'tomorrow', spend_only: true }, /period/],
  ])('rejects %o', async (args, re) => {
    const r = await toolsA.run('aggregate', args);
    expect(r.error).toMatch(re);
  });
});

describe('merchant names are canonical (BE-006)', () => {
  it('Q3 no longer splits Zomato: one row per shop, and "Zomato Ltd" in a question finds it', async () => {
    const top = await toolsA.run('top_merchants', { period: 'all_time', n: 20 });
    const names = top.merchants.map((m) => m.merchant);
    const [variants] = await db.query(
      "SELECT DISTINCT merchant FROM transactions WHERE user_id = ? AND (merchant LIKE '%zomato%' OR merchant LIKE '%amazon%') ORDER BY merchant",
      [A],
    );
    const asked = await toolsA.run('spend_summary', { period: 'all_time', merchants: ['Zomato Ltd'] });
    const plain = await toolsA.run('spend_summary', { period: 'all_time', merchants: ['zomato'] });

    expect(variants.map((v) => v.merchant)).toEqual(['Amazon', 'Zomato']);
    expect(names.filter((n) => /zomato/i.test(n))).toEqual(['Zomato']);
    expect(names.filter((n) => /amazon/i.test(n))).toEqual(['Amazon']);
    expect(asked.total.paise).toBe(plain.total.paise);
    expect(asked.total.paise).toBeGreaterThan(0);
  });
});
