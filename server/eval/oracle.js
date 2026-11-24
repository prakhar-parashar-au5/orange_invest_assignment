// The eval's source of truth. Hand-written SQL with literal date bounds, computed at run time from
// the seeded data. It deliberately shares NO code with the agent: no tools, no query builder, no
// resolvePeriod, no spendFilterSql. Grading the agent against its own tool output would prove
// nothing.
//
// Spend, as written in GLOSSARY.md: debits whose category is neither Self-transfer nor Investments.
import moment from 'moment-timezone';

const SPEND = "direction = 'debit' AND category NOT IN ('Self-transfer', 'Investments')";
const D = 'YYYY-MM-DD';

/** Literal date bounds, relative to "now" in IST. Written out here rather than imported. */
export function dateBounds(now) {
  const today = moment(now).tz('Asia/Kolkata').startOf('day');
  const monthStart = (m) => m.clone().startOf('month').format(D);
  const monthEnd = (m) => m.clone().endOf('month').format(D);
  const lastMonth = today.clone().subtract(1, 'month');
  const prevMonth = today.clone().subtract(2, 'months');
  let october = today.clone().month(9).startOf('month');
  if (october.isAfter(today)) october = october.subtract(1, 'year');
  return {
    today: today.format(D),
    yearStart: today.clone().startOf('year').format(D),
    lastMonth: [monthStart(lastMonth), monthEnd(lastMonth)],
    prevMonth: [monthStart(prevMonth), monthEnd(prevMonth)],
    october: [monthStart(october), moment.min(october.clone().endOf('month'), today).format(D)],
    last30: [today.clone().subtract(29, 'days').format(D), today.format(D)],
    lastCompleteMonthEnd: today.clone().startOf('month').subtract(1, 'day').format(D),
  };
}

/**
 * @param {import('mysql2/promise').Pool} db  read-only pool is enough
 * @returns {Promise<Record<string, number[] | string[]>>} paise lists (or names for 'mentions')
 */
export async function computeTruth(db, userId, now = moment()) {
  const b = dateBounds(now);
  const one = async (sql, params) => Number(Object.values((await db.query(sql, params))[0][0])[0] ?? 0);
  const col = async (sql, params) => (await db.query(sql, params))[0].map((r) => Object.values(r)[0]);
  const sumSpend = (from, to, extra = '', extraParams = []) =>
    one(`SELECT COALESCE(SUM(amount_paise), 0) FROM transactions WHERE user_id = ? AND txn_date BETWEEN ? AND ? AND ${SPEND} ${extra}`, [
      userId,
      from,
      to,
      ...extraParams,
    ]);

  const [first] = await col('SELECT MIN(txn_date) FROM transactions WHERE user_id = ?', [userId]);
  let monthlyAverage = 0;
  if (first) {
    const from = moment(first, D).startOf('month').format(D);
    const months = moment(b.lastCompleteMonthEnd, D).diff(moment(from, D), 'months') + 1;
    if (months > 0) monthlyAverage = Math.round((await sumSpend(from, b.lastCompleteMonthEnd)) / months);
  }

  return {
    spend_october: [await sumSpend(...b.october)],
    food_last_month: [await sumSpend(...b.lastMonth, "AND category = 'Food delivery'")],
    food_month_before_last: [await sumSpend(...b.prevMonth, "AND category = 'Food delivery'")],
    top5_this_year: (
      await col(
        `SELECT SUM(amount_paise) AS t FROM transactions WHERE user_id = ? AND txn_date BETWEEN ? AND ? AND ${SPEND}
           AND merchant IS NOT NULL GROUP BY merchant ORDER BY t DESC LIMIT 5`,
        [userId, b.yearStart, b.today],
      )
    ).map(Number),
    // Same amount (±10%) to the same merchant in 3+ months, self-transfers left out.
    recurring_merchants: (await db.query(
      `SELECT merchant AS name, ANY_VALUE(category) AS category FROM transactions WHERE user_id = ? AND direction = 'debit' AND merchant IS NOT NULL AND category <> 'Self-transfer'
        GROUP BY merchant
       HAVING COUNT(DISTINCT DATE_FORMAT(txn_date, '%Y-%m')) >= 3 AND MAX(amount_paise) <= MIN(amount_paise) * 1.1
        ORDER BY merchant`,
      [userId],
    ))[0].map((r) => ({ name: r.name, category: r.category })),
    last_vs_previous_month: [await sumSpend(...b.lastMonth), await sumSpend(...b.prevMonth)],
    // "Transactions" means every direction and category (prompt v2, BE-012): credits count too.
    transactions_above_5000_last_30_days: (
      await col(
        'SELECT amount_paise FROM transactions WHERE user_id = ? AND txn_date BETWEEN ? AND ? AND amount_paise > 500000 ORDER BY txn_date',
        [userId, ...b.last30],
      )
    ).map(Number),
    swiggy_zomato_all_time: [await one(`SELECT COALESCE(SUM(amount_paise), 0) FROM transactions WHERE user_id = ? AND ${SPEND} AND merchant IN ('Swiggy', 'Zomato')`, [userId])],
    monthly_average: [monthlyAverage],
    biggest_expense: [await one(`SELECT COALESCE(MAX(amount_paise), 0) FROM transactions WHERE user_id = ? AND ${SPEND}`, [userId])],
    salary_this_year: [
      await one("SELECT COALESCE(SUM(amount_paise), 0) FROM transactions WHERE user_id = ? AND direction = 'credit' AND category = 'Salary' AND txn_date BETWEEN ? AND ?", [
        userId,
        b.yearStart,
        b.today,
      ]),
    ],
  };
}

/** Every amount in a persona's truth, for the isolation gate. */
export const allAmounts = (truth) => [
  ...new Set(
    Object.values(truth)
      .flat()
      .filter((v) => typeof v === 'number' && v > 0),
  ),
];
