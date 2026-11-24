// The fixed v1 category list and the one definition of "spend". Nothing else in the codebase may
// spell a category name as a string literal except the rule table in categorise/rules.js, which is
// checked against this list by its tests.

export const CATEGORIES = Object.freeze([
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

export const UNIDENTIFIED = 'Unidentified';
export const TRANSFERS_OTHERS = 'Transfers (others)';
export const SELF_TRANSFER = 'Self-transfer';

/** Debits in these categories move money between the user's own pots; they are not spend. */
export const NON_SPEND_CATEGORIES = Object.freeze(['Self-transfer', 'Investments']);

const CATEGORY_SET = new Set(CATEGORIES);

export const isCategory = (value) => typeof value === 'string' && CATEGORY_SET.has(value);

/** Spend = a debit whose category is not Self-transfer or Investments. */
export const isSpend = ({ direction, category }) => direction === 'debit' && !NON_SPEND_CATEGORIES.includes(category);

/**
 * The same definition as a parameterised SQL condition, for the agent's tools.
 * Usage: `WHERE t.user_id = ? AND ${f.sql}` with params `[userId, ...f.params]`.
 * @param {string} [alias] table alias, e.g. 't'
 */
export function spendFilterSql(alias) {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  return {
    sql: `${col('direction')} = 'debit' AND ${col('category')} NOT IN (${NON_SPEND_CATEGORIES.map(() => '?').join(', ')})`,
    params: [...NON_SPEND_CATEGORIES],
  };
}

/** The shape served by GET /api/categories. */
export const categoriesForApi = () =>
  CATEGORIES.map((name) => ({ name, is_spend: !NON_SPEND_CATEGORIES.includes(name) }));
