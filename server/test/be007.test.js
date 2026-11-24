// BE-007: exact-first merchant matching, and the recategorise script's core.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import moment from 'moment-timezone';
import { testConfig, uniqueEmail } from './helpers.js';
import { createPool, createReadOnlyPool } from '../src/db.js';
import { createCategoriser } from '../src/categorise/index.js';
import { recategoriseUser } from '../src/categorise/recategorise.js';
import { createTools } from '../src/agent/tools.js';

const NOW = moment.tz('2026-11-24T12:00:00', 'Asia/Kolkata');
let db;
let ro;

beforeAll(() => {
  const config = testConfig();
  db = createPool(config.databaseUrl);
  ro = createReadOnlyPool(config.databaseUrl);
});
afterAll(async () => {
  await db.end();
  await ro.end();
});

/** A user with the given rows, inserted directly as stored rows. */
async function userWithRows(label, rows) {
  const [u] = await db.query('INSERT INTO users (email) VALUES (?)', [uniqueEmail(label)]);
  const [up] = await db.query(
    "INSERT INTO uploads (user_id, filename, file_hash, source_format) VALUES (?, 'f.csv', REPEAT('b', 64), 'test')",
    [u.insertId],
  );
  for (const [i, r] of rows.entries()) {
    await db.query(
      `INSERT INTO transactions (user_id, upload_id, source, txn_date, description_raw, merchant, category,
         amount_paise, direction, channel, raw_json, dedup_hash)
       VALUES (?, ?, 'test', ?, ?, ?, ?, ?, 'debit', ?, '{}', ?)`,
      [u.insertId, up.insertId, r.date ?? '2026-10-10', r.description, r.merchant, r.category, r.paise, r.channel ?? 'UPI', `${label}${i}`.padEnd(64, '0')],
    );
  }
  return u.insertId;
}

const categoriesOf = async (userId) => {
  const [rows] = await db.query('SELECT merchant, category FROM transactions WHERE user_id = ? ORDER BY id', [userId]);
  return rows.map((r) => [r.merchant, r.category]);
};

describe('exact-first merchant matching', () => {
  let tools;
  beforeAll(async () => {
    const id = await userWithRows('match', [
      { merchant: 'Swiggy', description: 'UPI-SWIGGY-swiggy@icici-1-x', category: 'Food delivery', paise: 50000 },
      { merchant: 'Swiggy Instamart', description: 'UPI-SWIGGY INSTAMART-x@icici-2-x', category: 'Groceries', paise: 120000 },
      { merchant: 'Zomato', description: 'UPI-ZOMATO-zomato@hdfcbank-3-x', category: 'Food delivery', paise: 30000 },
    ]);
    tools = createTools({ db: ro, userId: id, now: NOW });
  });

  it('"swiggy" with both Swiggy and Swiggy Instamart present → Swiggy only, and says what matched', async () => {
    const r = await tools.run('spend_summary', { period: 'all_time', merchants: ['swiggy'] });

    expect(r.total.paise).toBe(50000);
    expect(r.filters.matched_merchants).toEqual(['Swiggy']);
  });

  it('"zom" (no exact match) → falls back to partial match', async () => {
    const r = await tools.run('spend_summary', { period: 'all_time', merchants: ['zom'] });

    expect(r.total.paise).toBe(30000);
    expect(r.filters.matched_merchants).toEqual(['Zomato']);
  });

  it('applies per name: "swiggy" + "instamart" → both; an unknown name matches nothing', async () => {
    const both = await tools.run('aggregate', { metric: 'sum', period: 'all_time', direction: 'debit', merchants: ['swiggy', 'instamart'] });
    const none = await tools.run('list_transactions', { period: 'all_time', merchant: 'nobody-here' });

    expect(both.value.paise).toBe(170000);
    expect(both.filters.matched_merchants).toEqual(['Swiggy', 'Swiggy Instamart']);
    expect(none).toMatchObject({ matching_count: 0, filters: { matched_merchants: [] } });
  });
});

describe('recategoriseUser', () => {
  it('re-categorises Unidentified rows through the categoriser, only for that user, only changed rows', async () => {
    const shop = { merchant: 'Zqx Pharma Mart', description: 'UPI-ZQX PHARMA MART-zqx@ybl-1-x', category: 'Unidentified', paise: 40000 };
    const target = await userWithRows('recat-a', [
      shop,
      { ...shop, description: 'UPI-ZQX PHARMA MART-zqx@ybl-2-x', paise: 41000 },
      { merchant: 'Swiggy', description: 'UPI-SWIGGY-swiggy@icici-3-x', category: 'Food delivery', paise: 20000 },
      { merchant: 'Rahul Sharma', description: 'UPI-RAHUL SHARMA-9876543210@ybl-4-x', category: 'Unidentified', paise: 5000 },
    ]);
    const bystander = await userWithRows('recat-b', [shop]);
    const classify = vi.fn(async (names) => names.map(() => 'Health'));
    const categoriser = createCategoriser({ db, classifier: { classify }, logger: { warn() {} } });

    const result = await recategoriseUser({ db, categoriser, userId: target });

    expect(result).toEqual({ looked: 3, changed: 3, stillUnidentified: 0 });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0][0]).toEqual(['ZQX PHARMA MART']); // one unique name; the P2P name is never sent
    expect(await categoriesOf(target)).toEqual([
      ['Zqx Pharma Mart', 'Health'],
      ['Zqx Pharma Mart', 'Health'],
      ['Swiggy', 'Food delivery'],
      ['Rahul Sharma', 'Transfers (others)'],
    ]);
    expect(await categoriesOf(bystander)).toEqual([['Zqx Pharma Mart', 'Unidentified']]);
  });

  it('without a key: rules still fix what they can, nothing that needs the LLM changes', async () => {
    const id = await userWithRows('recat-nokey', [
      { merchant: 'Swiggy', description: 'UPI-SWIGGY-swiggy@icici-1-x', category: 'Unidentified', paise: 20000 },
      { merchant: 'Qqq Unknown Traders', description: 'UPI-QQQ UNKNOWN TRADERS-q@ybl-2-x', category: 'Unidentified', paise: 9000 },
    ]);
    const categoriser = createCategoriser({ db, classifier: null, logger: { warn() {} } });

    const result = await recategoriseUser({ db, categoriser, userId: id });

    expect(result).toEqual({ looked: 2, changed: 1, stillUnidentified: 1 });
    expect(await categoriesOf(id)).toEqual([
      ['Swiggy', 'Food delivery'],
      ['Qqq Unknown Traders', 'Unidentified'],
    ]);
  });
});
