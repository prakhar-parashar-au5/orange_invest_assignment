import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CATEGORIES, NON_SPEND_CATEGORIES, isCategory, isSpend, spendFilterSql } from '../src/categories.js';
import { testConfig, uniqueEmail } from './helpers.js';
import { createPool } from '../src/db.js';

describe('CATEGORIES', () => {
  it('is exactly the fixed v1 list, in display order', () => {
    expect(CATEGORIES).toEqual([
      'Food delivery',
      'Groceries',
      'Dining',
      'Shopping',
      'Travel',
      'Fuel',
      'Bills & utilities',
      'Rent',
      'EMI/loans',
      'Investments',
      'Insurance',
      'Health',
      'Entertainment',
      'Self-transfer',
      'Transfers (others)',
      'Salary',
      'Refunds',
      'Cash withdrawal',
      'Unidentified',
    ]);
    expect(Object.isFrozen(CATEGORIES)).toBe(true);
  });

  it('isCategory accepts only exact names', () => {
    expect(isCategory('Food delivery')).toBe(true);
    expect(isCategory('food delivery')).toBe(false);
    expect(isCategory('Stocks')).toBe(false);
    expect(isCategory(undefined)).toBe(false);
  });
});

describe('spend', () => {
  it('excludes only Self-transfer and Investments', () => {
    expect(NON_SPEND_CATEGORIES).toEqual(['Self-transfer', 'Investments']);
  });

  it.each([
    ['debit', 'Food delivery', true],
    ['debit', 'Unidentified', true],
    ['debit', 'Cash withdrawal', true],
    ['debit', 'Self-transfer', false],
    ['debit', 'Investments', false],
    ['credit', 'Salary', false],
    ['credit', 'Food delivery', false],
  ])('a %s in %s is spend: %s', (direction, category, expected) => {
    expect(isSpend({ direction, category })).toBe(expected);
  });

  describe('spendFilterSql against MySQL', () => {
    let db;
    beforeAll(() => {
      db = createPool(testConfig().databaseUrl);
    });
    afterAll(() => db.end());

    it('sums the same rows as isSpend', async () => {
      const [u] = await db.query('INSERT INTO users (email) VALUES (?)', [uniqueEmail('spend')]);
      const userId = u.insertId;
      const [up] = await db.query(
        "INSERT INTO uploads (user_id, filename, file_hash, source_format) VALUES (?, 'f.csv', REPEAT('a', 64), 'test')",
        [userId],
      );
      const rows = [
        ['debit', 'Food delivery', 10000],
        ['debit', 'Unidentified', 2500],
        ['debit', 'Self-transfer', 500000],
        ['debit', 'Investments', 300000],
        ['credit', 'Salary', 9000000],
        ['credit', 'Refunds', 1500],
      ];
      for (const [i, [direction, category, amount]] of rows.entries()) {
        await db.query(
          `INSERT INTO transactions (user_id, upload_id, source, txn_date, description_raw, category,
             amount_paise, direction, raw_json, dedup_hash)
           VALUES (?, ?, 'test', '2026-10-01', 'x', ?, ?, ?, '{}', ?)`,
          [userId, up.insertId, category, amount, direction, `h${i}`.padEnd(64, '0')],
        );
      }

      const filter = spendFilterSql();
      const [[{ total }]] = await db.query(
        `SELECT COALESCE(SUM(amount_paise), 0) AS total FROM transactions WHERE user_id = ? AND ${filter.sql}`,
        [userId, ...filter.params],
      );

      const expected = rows
        .filter(([direction, category]) => isSpend({ direction, category }))
        .reduce((sum, [, , amount]) => sum + amount, 0);
      expect(Number(total)).toBe(expected);
      expect(expected).toBe(12500);
    });

    it('can be used with a table alias', () => {
      expect(spendFilterSql('t').sql).toBe("t.direction = 'debit' AND t.category NOT IN (?, ?)");
    });
  });
});
