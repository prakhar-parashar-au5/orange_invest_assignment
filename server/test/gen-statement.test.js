import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateStatement, todayIst } from '../scripts/gen-statement.js';
import { parseStatement } from '../src/ingest/parse-statement.js';
import { ruleCategory } from '../src/categorise/rules.js';
import { isSpend } from '../src/categories.js';

const END = '2026-11-24';
const sha = (s) => createHash('sha256').update(s).digest('hex');

function categorised(csv) {
  const { rows, rejected } = parseStatement(Buffer.from(csv));
  const withCategory = rows.map((r) => ({
    ...r,
    category:
      ruleCategory({ merchant: r.merchant, description: r.description_raw, direction: r.direction, channel: r.channel }) ??
      (r.isPerson ? 'Transfers (others)' : 'Unidentified'),
  }));
  return { rows: withCategory, rejected };
}

const month = (d) => d.slice(0, 7);
const has = (rows, re) => rows.some((r) => re.test(r.description_raw));

describe('generateStatement', () => {
  it('is deterministic per seed and end date', () => {
    const a = generateStatement({ seed: 7, months: 14, end: END });
    const b = generateStatement({ seed: 7, months: 14, end: END });
    const c = generateStatement({ seed: 8, months: 14, end: END });

    expect(sha(a)).toBe(sha(b));
    expect(sha(a)).not.toBe(sha(c));
  });

  it('uses the HDFC-like header and parses with zero rejected rows', () => {
    const csv = generateStatement({ seed: 1, months: 14, end: END });
    const { rows, rejected } = categorised(csv);

    expect(csv.split('\n')[0]).toBe('Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance');
    expect(rejected).toEqual([]);
    expect(rows.length).toBeGreaterThan(14 * 30);
    const dates = rows.map((r) => r.txn_date).sort();
    expect(dates[0] >= '2025-10-01').toBe(true);
    expect(dates.at(-1) <= END).toBe(true);
  });

  it('covers everything the golden questions need', () => {
    const { rows } = categorised(generateStatement({ seed: 1, months: 14, end: END }));
    const months = [...new Set(rows.map((r) => month(r.txn_date)))];
    expect(months).toHaveLength(14);

    // recurring: salary, rent, EMI, Netflix, Spotify in every full month
    for (const m of months.slice(0, -1)) {
      const inMonth = rows.filter((r) => month(r.txn_date) === m);
      expect(inMonth.filter((r) => r.category === 'Salary' && r.direction === 'credit')).toHaveLength(1);
      expect(inMonth.filter((r) => r.category === 'Rent')).toHaveLength(1);
      expect(inMonth.filter((r) => r.category === 'EMI/loans')).toHaveLength(1);
      expect(inMonth.filter((r) => /NETFLIX/.test(r.description_raw))).toHaveLength(1);
      expect(inMonth.filter((r) => /SPOTIFY/.test(r.description_raw))).toHaveLength(1);
    }
    for (const re of [/NETFLIX/, /SPOTIFY/, /RENT/, /BAJAJ FINANCE/]) {
      const amounts = rows.filter((r) => re.test(r.description_raw)).map((r) => r.amount_paise).sort((x, y) => x - y);
      const median = amounts[Math.floor(amounts.length / 2)];
      expect(amounts.every((a) => Math.abs(a - median) <= median * 0.1)).toBe(true);
    }

    expect(rows.some((r) => r.category === 'Investments' && /SIP/.test(r.description_raw))).toBe(true);
    expect(rows.some((r) => r.category === 'Self-transfer')).toBe(true);
    for (const re of [/SWIGGY/, /ZOMATO/, /BIGBASKET|BLINKIT|ZEPTO/, /HPCL|INDIAN OIL/, /IRCTC/]) expect(has(rows, re)).toBe(true);

    // above ₹5,000 in the last 30 days (spend debits)
    const since = '2026-10-25';
    const big = rows.filter((r) => r.txn_date >= since && r.direction === 'debit' && r.amount_paise > 500000 && isSpend(r));
    expect(big.length).toBeGreaterThanOrEqual(3);

    // one clear largest expense
    const debits = rows.filter((r) => isSpend(r)).map((r) => r.amount_paise).sort((x, y) => y - x);
    expect(debits[0]).toBeGreaterThanOrEqual(debits[1] * 1.5);

    // last month (Oct 2026) noticeably higher than the month before (Sep 2026), driven by Travel
    const spendIn = (m, cat) =>
      rows.filter((r) => month(r.txn_date) === m && isSpend(r) && (!cat || r.category === cat)).reduce((s, r) => s + r.amount_paise, 0);
    expect(spendIn('2026-10')).toBeGreaterThanOrEqual(spendIn('2026-09') * 1.2);
    expect(spendIn('2026-10', 'Travel') - spendIn('2026-09', 'Travel')).toBeGreaterThan(
      (spendIn('2026-10') - spendIn('2026-09')) * 0.6,
    );

    // unknown merchants (business names no rule knows) for the LLM fallback
    expect(rows.filter((r) => r.category === 'Unidentified' && r.merchant && !r.isPerson).length).toBeGreaterThan(5);
    // person-to-person payments
    expect(rows.some((r) => r.isPerson && r.category === 'Transfers (others)')).toBe(true);

    // the balance never goes negative
    expect(rows.every((r) => r.balance_paise >= 0)).toBe(true);
  });

  it('todayIst returns the IST calendar date', () => {
    expect(todayIst(new Date('2026-11-24T19:00:00Z'))).toBe('2026-11-25');
    expect(todayIst(new Date('2026-11-24T18:00:00Z'))).toBe('2026-11-24');
  });
});
