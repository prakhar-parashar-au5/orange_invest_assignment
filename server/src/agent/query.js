// The ONLY place the agent's tools touch SQL. Every query built here:
//   - starts with `user_id = ?`, bound to the userId this builder was created for
//   - filters txn_date to a period already resolved on the server
//   - binds every value as a parameter; column names and SQL fragments come only from the fixed
//     maps below, never from input
//   - applies spendFilterSql() when spendOnly is set, so "spend" has one definition
// It runs on the read-only pool, so a bug here still can't write.
import { spendFilterSql } from '../categories.js';

export const METRICS = ['sum', 'count', 'avg', 'max'];
export const GROUPS = ['none', 'category', 'merchant', 'month', 'day'];

const METRIC_SQL = {
  sum: 'COALESCE(SUM(amount_paise), 0)',
  count: 'COUNT(*)',
  avg: 'ROUND(AVG(amount_paise))',
  max: 'MAX(amount_paise)',
};
const GROUP_SQL = {
  category: 'category',
  merchant: 'merchant',
  month: "DATE_FORMAT(txn_date, '%Y-%m')",
  day: "DATE_FORMAT(txn_date, '%Y-%m-%d')",
};
const LIST_ORDER_SQL = {
  date_desc: 'txn_date DESC, id DESC',
  amount_desc: 'amount_paise DESC, txn_date DESC, id DESC',
  merchant_date: 'merchant ASC, txn_date ASC, id ASC',
};
const LIST_COLUMNS = 'txn_date, merchant, category, amount_paise, direction, channel';
const MAX_SCAN_ROWS = 20000;

const num = (v) => (v === null || v === undefined ? null : Number(v));
const likeParam = (s) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * @typedef {object} Filters
 * @property {{ from: string, to: string }} [period]   resolved IST dates; omitted = all of the user's data
 * @property {string} [category]
 * @property {string[]} [excludeCategories]
 * @property {string[]} [merchantNames]    exact stored merchant names (from resolveMerchants); [] matches nothing
 * @property {'debit'|'credit'} [direction]
 * @property {boolean} [spendOnly]
 * @property {number} [minAmountPaise]     inclusive
 * @property {boolean} [hasMerchant]
 */

/**
 * @param {{ db: import('mysql2/promise').Pool, userId: number }} deps  db = the read-only pool
 */
export function createQueryBuilder({ db, userId }) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('the query builder needs the session userId');

  /** @param {Filters} f */
  function where(f) {
    const clauses = ['user_id = ?'];
    const params = [userId];
    const add = (sql, ...values) => {
      clauses.push(sql);
      params.push(...values);
    };
    if (f.period) add('txn_date BETWEEN ? AND ?', f.period.from, f.period.to);
    if (f.spendOnly) {
      const spend = spendFilterSql();
      add(spend.sql, ...spend.params);
    }
    if (f.direction) add('direction = ?', f.direction);
    if (f.category) add('category = ?', f.category);
    if (f.excludeCategories?.length) add(`category NOT IN (${f.excludeCategories.map(() => '?').join(', ')})`, ...f.excludeCategories);
    if (f.minAmountPaise !== undefined) add('amount_paise >= ?', f.minAmountPaise);
    if (f.merchantNames) {
      if (f.merchantNames.length === 0) add('1 = 0');
      else add(`merchant IN (${f.merchantNames.map(() => '?').join(', ')})`, ...f.merchantNames);
    }
    if (f.hasMerchant) add('merchant IS NOT NULL');
    return { sql: clauses.join(' AND '), params };
  }

  return {
    /**
     * Turns requested merchant names into this user's stored merchant names, one name at a time:
     * an exact (case-insensitive) match if the user has one, otherwise a partial match.
     * So 'swiggy' means Swiggy, not Swiggy Instamart, while 'zom' still finds Zomato.
     * @param {string[]} names already canonical
     * @returns {Promise<string[]>} distinct stored names, sorted
     */
    async resolveMerchants(names) {
      const matched = new Set();
      for (const name of names) {
        const [exact] = await db.query(
          'SELECT DISTINCT merchant FROM transactions WHERE user_id = ? AND merchant IS NOT NULL AND LOWER(merchant) = LOWER(?)',
          [userId, name],
        );
        const rows = exact.length
          ? exact
          : (await db.query('SELECT DISTINCT merchant FROM transactions WHERE user_id = ? AND LOWER(merchant) LIKE ? LIMIT 50', [userId, likeParam(name)]))[0];
        for (const r of rows) matched.add(r.merchant);
      }
      return [...matched].sort((a, b) => a.localeCompare(b));
    },

    /**
     * One number, or one number per group.
     * Grouping by merchant leaves out transactions with no merchant (ATM, some bank charges).
     * @param {Filters & { metric: string, groupBy?: string, order?: 'asc'|'desc', limit?: number }} spec
     * @returns {Promise<{ value: number|null, count: number } | { key: string, value: number|null, count: number }[]>}
     */
    async aggregate({ metric, groupBy = 'none', order, limit = 50, ...filters }) {
      const metricSql = METRIC_SQL[metric];
      if (!metricSql) throw new Error(`unknown metric ${metric}`);
      const w = where(groupBy === 'merchant' ? { ...filters, hasMerchant: true } : filters);

      if (groupBy === 'none') {
        const [[row]] = await db.query(`SELECT ${metricSql} AS v, COUNT(*) AS cnt FROM transactions WHERE ${w.sql}`, w.params);
        return { value: num(row.v), count: num(row.cnt) };
      }
      const keySql = GROUP_SQL[groupBy];
      if (!keySql) throw new Error(`unknown group ${groupBy}`);
      const timeGroup = groupBy === 'month' || groupBy === 'day';
      const dir = (order ?? (timeGroup ? 'asc' : 'desc')) === 'asc' ? 'ASC' : 'DESC';
      // Time groups sort by time; the others sort by the metric, with the key as a stable tiebreak.
      const orderSql = timeGroup ? `k ${dir}` : `v ${dir}, k ASC`;
      const [rows] = await db.query(
        `SELECT ${keySql} AS k, ${metricSql} AS v, COUNT(*) AS cnt FROM transactions
          WHERE ${w.sql} GROUP BY ${keySql} ORDER BY ${orderSql} LIMIT ?`,
        [...w.params, limit],
      );
      return rows.map((r) => ({ key: r.k, value: num(r.v), count: num(r.cnt) }));
    },

    /**
     * Individual transactions (display columns only, never descriptions), plus the count and sum of
     * everything that matched, not just the rows returned.
     * @param {Filters & { sort?: string, limit?: number }} spec
     */
    async list({ sort = 'date_desc', limit = 20, ...filters }) {
      const orderSql = LIST_ORDER_SQL[sort];
      if (!orderSql) throw new Error(`unknown sort ${sort}`);
      const w = where(filters);
      const [[agg]] = await db.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_paise), 0) AS total FROM transactions WHERE ${w.sql}`, w.params);
      const [rows] = await db.query(`SELECT ${LIST_COLUMNS} FROM transactions WHERE ${w.sql} ORDER BY ${orderSql} LIMIT ?`, [
        ...w.params,
        Math.min(limit, MAX_SCAN_ROWS),
      ]);
      return {
        count: num(agg.cnt),
        total: num(agg.total),
        rows: rows.map((r) => ({ ...r, amount_paise: num(r.amount_paise) })),
      };
    },

    /** The user's first and last transaction dates, or nulls if there are none. */
    async dataSpan() {
      const w = where({});
      const [[row]] = await db.query(`SELECT MIN(txn_date) AS first, MAX(txn_date) AS last FROM transactions WHERE ${w.sql}`, w.params);
      return { first: row.first, last: row.last };
    },
  };
}

export const SCAN_LIMIT = MAX_SCAN_ROWS;
