// The agent's typed, read-only tools: thin presets over one query builder (query.js), which is
// the only place that writes SQL, adds `user_id = ?` and applies the spend definition.
// - The model never sets or sees user_id: createTools() is bound to the session user.
// - Periods come in as tokens and are resolved on the server (periods.js).
// - Sums, counts, averages and deltas are computed on the server. Money comes back as { paise, inr }.
// - Bad input comes back as { error } for the model to fix.
// Seven tools cover the golden questions. `aggregate` is the validated fallback for the rest.
import { CATEGORIES, NON_SPEND_CATEGORIES, SELF_TRANSFER, isCategory } from '../categories.js';
import { resolvePeriod, completeMonths, PERIOD_HELP } from './periods.js';
import { createQueryBuilder, METRICS, GROUPS, SCAN_LIMIT } from './query.js';
import { money } from '../util/money.js';
import { canonicalMerchant } from '../ingest/merchant-names.js';

export class ToolInputError extends Error {}

const MAX_DAY_GROUP_DAYS = 92;

// ---------- argument validation ----------

const fail = (msg) => {
  throw new ToolInputError(msg);
};
const given = (v) => v !== undefined && v !== null;

function obj(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) fail('arguments must be an object');
  return args;
}
function oneOf(value, name, allowed, fallback) {
  if (!given(value)) return fallback;
  if (!allowed.includes(value)) fail(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}
function int(value, name, { min, max, fallback }) {
  if (!given(value)) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) fail(`${name} must be an integer ${min}–${max}`);
  return value;
}
function bool(value, name) {
  if (!given(value)) return false;
  if (typeof value !== 'boolean') fail(`${name} must be true or false`);
  return value;
}
function category(value) {
  if (!given(value)) return undefined;
  if (!isCategory(value)) fail(`category must be one of: ${CATEGORIES.join(', ')}`);
  return value;
}
function merchantList(value) {
  if (!given(value)) return undefined;
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0 || list.length > 10 || !list.every((m) => typeof m === 'string' && m.trim().length > 0 && m.length <= 60)) {
    fail('merchants must be 1–10 non-empty names');
  }
  // Match on the canonical name, the same form stored at ingest: 'Zomato Ltd' finds 'Zomato'.
  return list.map((m) => canonicalMerchant(m.trim()) ?? m.trim());
}
function period(value, now, name = 'period') {
  try {
    return resolvePeriod(value, now);
  } catch (err) {
    throw new ToolInputError(`${name}: ${err.message}`);
  }
}

const periodOut = (p) => ({ from: p.from, to: p.to, label: p.label });
const daysIn = (p) => Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86400000) + 1;
/** count → a plain integer; every other metric is money */
const metricValue = (metric, v) => (metric === 'count' ? v : v === null ? null : money(v));

// ---------- tool definitions (OpenAI function-calling JSON schema) ----------

const PERIOD_SCHEMA = {
  type: 'string',
  description: `Time period, resolved on the server in IST. ${PERIOD_HELP}. A month named without a year: month_name:<name>.`,
};
const CATEGORY_SCHEMA = { type: 'string', enum: [...CATEGORIES] };
const MERCHANTS_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
  maxItems: 10,
  description: 'merchant names, several added together. Each name matches that exact merchant if the user has it ("swiggy" is Swiggy, not Swiggy Instamart), otherwise any merchant containing it. The result lists matched_merchants.',
};
const SPEND = `Spend = debits excluding ${NON_SPEND_CATEGORIES.join(' and ')}.`;

export const TOOL_DEFINITIONS = [
  {
    name: 'spend_summary',
    description: `Total spend (metric=sum) or number of spend transactions (metric=count) in a period, optionally grouped. ${SPEND} Optional filters: one category, or merchant names.`,
    parameters: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA,
        metric: { type: 'string', enum: ['sum', 'count'] },
        group_by: { type: 'string', enum: ['none', 'category', 'merchant', 'month'] },
        category: CATEGORY_SCHEMA,
        merchants: MERCHANTS_SCHEMA,
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_transactions',
    description:
      'List individual transactions in a period with optional filters. sort=amount_desc with limit=1 gives the biggest one. ' +
      '"Transactions" means every direction and category: money in and out, self-transfers and investments included. ' +
      `Set spend_only=true only when the user asks about spend, spending, expenses or cost (${SPEND})`,
    parameters: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA,
        min_amount_paise: { type: 'integer', minimum: 1, description: 'inclusive; for "above ₹5,000" pass 500001' },
        category: CATEGORY_SCHEMA,
        merchant: { type: 'string' },
        direction: { type: 'string', enum: ['debit', 'credit'] },
        spend_only: { type: 'boolean', description: 'Only when the user asks about spend, spending, expenses or cost. Leave it out for "transactions".' },
        sort: { type: 'string', enum: ['date_desc', 'amount_desc'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    name: 'top_merchants',
    description: 'Merchants ranked by spend in a period. Transactions with no merchant (ATM withdrawals, some bank charges) are left out.',
    parameters: {
      type: 'object',
      properties: { period: PERIOD_SCHEMA, n: { type: 'integer', minimum: 1, maximum: 20 } },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_periods',
    description: 'Compare spend between period a and period b: totals, the difference, and per-category differences sorted by size.',
    parameters: {
      type: 'object',
      properties: { a: PERIOD_SCHEMA, b: PERIOD_SCHEMA },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  },
  {
    name: 'recurring_payments',
    description:
      'Payments to the same merchant in 3 or more different months with an amount within ±10% each time ' +
      '(subscriptions, rent, EMIs, SIPs, bills). Self-transfers are left out.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'income_summary',
    description: 'Money received (credits) in a period, by category, optionally for one category such as Salary.',
    parameters: {
      type: 'object',
      properties: { period: PERIOD_SCHEMA, category: CATEGORY_SCHEMA },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    name: 'monthly_average',
    description:
      'Average monthly spend over the complete calendar months in a period (the current, unfinished month is never counted), ' +
      "counted from the month of the user's first transaction, optionally for one category. Months with no spend count as zero.",
    parameters: {
      type: 'object',
      properties: { period: PERIOD_SCHEMA, category: CATEGORY_SCHEMA },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    name: 'aggregate',
    description:
      'Generic fallback: use only when none of the other tools fits. Computes one metric over transactions in a period, ' +
      'optionally grouped. metric: sum | count | avg | max (avg and max are per transaction). ' +
      'sum, avg and max need spend_only=true or a direction, because adding money in and money out together means nothing. ' +
      `${SPEND} order and limit apply only when grouping. group_by=day covers at most ${MAX_DAY_GROUP_DAYS} days.`,
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: [...METRICS] },
        period: PERIOD_SCHEMA,
        category: CATEGORY_SCHEMA,
        merchants: MERCHANTS_SCHEMA,
        direction: { type: 'string', enum: ['debit', 'credit'] },
        spend_only: { type: 'boolean' },
        group_by: { type: 'string', enum: [...GROUPS] },
        order: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['metric', 'period'],
      additionalProperties: false,
    },
  },
];

/** The same definitions in the OpenAI `tools` request shape. */
export const OPENAI_TOOLS = TOOL_DEFINITIONS.map((d) => ({ type: 'function', function: d }));

// ---------- implementations ----------

/**
 * @param {{ db: import('mysql2/promise').Pool, userId: number, now?: import('moment').Moment }} deps  db = the read-only pool
 */
export function createTools({ db, userId, now }) {
  const q = createQueryBuilder({ db, userId });
  /** requested names → { merchantNames } filter plus what matched, for the result */
  const resolve = async (requested) => {
    if (!requested) return { merchantNames: undefined, report: {} };
    const merchantNames = await q.resolveMerchants(requested);
    return { merchantNames, report: { merchants: requested, matched_merchants: merchantNames } };
  };

  const impl = {
    async spend_summary(args) {
      const a = obj(args);
      const p = period(a.period, now);
      const metric = oneOf(a.metric, 'metric', ['sum', 'count'], 'sum');
      const groupBy = oneOf(a.group_by, 'group_by', ['none', 'category', 'merchant', 'month'], 'none');
      const categoryName = category(a.category);
      const m = await resolve(merchantList(a.merchants));
      const filters = { period: p, spendOnly: true, category: categoryName, merchantNames: m.merchantNames };

      const all = await q.aggregate({ ...filters, metric: 'sum' });
      const out = {
        period: periodOut(p),
        filters: { category: categoryName ?? null, merchants: null, ...m.report },
        metric,
        total: money(all.value),
        txn_count: all.count,
      };
      if (groupBy !== 'none') {
        const rows = await q.aggregate({ ...filters, metric, groupBy, limit: 40 });
        out.group_by = groupBy;
        out.groups = rows.map((r) =>
          metric === 'count' ? { key: r.key, txn_count: r.count } : { key: r.key, total: money(r.value), txn_count: r.count },
        );
      }
      return out;
    },

    async list_transactions(args) {
      const a = obj(args);
      const p = period(a.period, now);
      const spendOnly = bool(a.spend_only, 'spend_only');
      const direction = oneOf(a.direction, 'direction', ['debit', 'credit'], undefined);
      if (spendOnly && direction === 'credit') fail('spend_only=true already means debits; drop direction=credit');
      const m = await resolve(given(a.merchant) ? merchantList([a.merchant]) : undefined);
      const r = await q.list({
        period: p,
        minAmountPaise: int(a.min_amount_paise, 'min_amount_paise', { min: 1, max: Number.MAX_SAFE_INTEGER, fallback: undefined }),
        category: category(a.category),
        merchantNames: m.merchantNames,
        direction,
        spendOnly,
        sort: oneOf(a.sort, 'sort', ['date_desc', 'amount_desc'], 'date_desc'),
        limit: int(a.limit, 'limit', { min: 1, max: 50, fallback: 20 }),
      });
      return {
        period: periodOut(p),
        filters: { merchants: null, ...m.report },
        matching_count: r.count,
        matching_total: money(r.total),
        shown: r.rows.length,
        transactions: r.rows.map((t) => ({
          date: t.txn_date,
          merchant: t.merchant,
          category: t.category,
          amount: money(t.amount_paise),
          direction: t.direction,
          channel: t.channel,
        })),
      };
    },

    async top_merchants(args) {
      const a = obj(args);
      const p = period(a.period, now);
      const limit = int(a.n, 'n', { min: 1, max: 20, fallback: 5 });
      const rows = await q.aggregate({ period: p, spendOnly: true, metric: 'sum', groupBy: 'merchant', order: 'desc', limit });
      return {
        period: periodOut(p),
        merchants: rows.map((r, i) => ({ rank: i + 1, merchant: r.key, total: money(r.value), txn_count: r.count })),
      };
    },

    async compare_periods(args) {
      const a = obj(args);
      const pa = period(a.a, now, 'a');
      const pb = period(a.b, now, 'b');
      const byCat = async (p) =>
        new Map((await q.aggregate({ period: p, spendOnly: true, metric: 'sum', groupBy: 'category' })).map((r) => [r.key, r.value]));
      const [ca, cb] = [await byCat(pa), await byCat(pb)];
      const sum = (m) => [...m.values()].reduce((s, v) => s + v, 0);
      const [ta, tb] = [sum(ca), sum(cb)];
      const byCategory = [...new Set([...ca.keys(), ...cb.keys()])]
        .map((c) => ({ category: c, a: ca.get(c) ?? 0, b: cb.get(c) ?? 0 }))
        .map((r) => ({ category: r.category, a: money(r.a), b: money(r.b), difference: money(r.a - r.b) }))
        .sort((x, y) => Math.abs(y.difference.paise) - Math.abs(x.difference.paise) || x.category.localeCompare(y.category));
      return {
        a: { period: periodOut(pa), total: money(ta) },
        b: { period: periodOut(pb), total: money(tb) },
        difference: money(ta - tb),
        difference_pct: tb === 0 ? null : Math.round(((ta - tb) * 1000) / tb) / 10,
        by_category: byCategory,
      };
    },

    async recurring_payments(args) {
      obj(args ?? {});
      const { rows } = await q.list({
        direction: 'debit',
        hasMerchant: true,
        excludeCategories: [SELF_TRANSFER],
        sort: 'merchant_date',
        limit: SCAN_LIMIT,
      });
      const byMerchant = new Map();
      for (const r of rows) {
        if (!byMerchant.has(r.merchant)) byMerchant.set(r.merchant, []);
        byMerchant.get(r.merchant).push(r);
      }
      const out = [];
      for (const [merchant, list] of byMerchant) {
        const amounts = list.map((r) => r.amount_paise).sort((x, y) => x - y);
        const median = amounts[Math.floor((amounts.length - 1) / 2)];
        // integer check for |amount - median| <= 10% of median
        const matching = list.filter((r) => Math.abs(r.amount_paise - median) * 10 <= median);
        const months = new Set(matching.map((r) => r.txn_date.slice(0, 7)));
        // Most of the merchant's payments must look alike. A food app with one order a month that
        // happens to land near the median isn't a subscription.
        if (months.size >= 3 && matching.length * 4 >= list.length * 3) {
          out.push({
            merchant,
            category: matching.at(-1).category,
            typical_amount: money(median),
            months_seen: months.size,
            payments: matching.length,
            first_date: matching[0].txn_date,
            last_date: matching.at(-1).txn_date,
          });
        }
      }
      out.sort((x, y) => y.typical_amount.paise - x.typical_amount.paise || x.merchant.localeCompare(y.merchant));
      return { recurring: out, rule: 'same merchant in 3+ different months, amount within ±10% of its usual amount' };
    },

    async income_summary(args) {
      const a = obj(args);
      const p = period(a.period, now);
      const categoryName = category(a.category);
      const rows = await q.aggregate({ period: p, direction: 'credit', category: categoryName, metric: 'sum', groupBy: 'category' });
      return {
        period: periodOut(p),
        category: categoryName ?? null,
        total: money(rows.reduce((s, r) => s + r.value, 0)),
        txn_count: rows.reduce((s, r) => s + r.count, 0),
        by_category: rows.map((r) => ({ category: r.key, total: money(r.value), txn_count: r.count })),
      };
    },

    async monthly_average(args) {
      const a = obj(args);
      const p = period(a.period, now);
      const categoryName = category(a.category);
      const span = await q.dataSpan();
      if (!span.first) return { period: periodOut(p), months_counted: 0, average: null, months: [], note: 'no transactions yet' };
      // Only complete months inside both the period and the user's data
      const months = completeMonths(p, now).filter((m) => m >= span.first.slice(0, 7) && m <= span.last.slice(0, 7));
      if (months.length === 0) {
        return { period: periodOut(p), months_counted: 0, average: null, months: [], note: 'no complete month in this period' };
      }
      const rows = await q.aggregate({
        period: { from: `${months[0]}-01`, to: p.to },
        spendOnly: true,
        category: categoryName,
        metric: 'sum',
        groupBy: 'month',
        limit: 200,
      });
      const byMonth = new Map(rows.map((r) => [r.key, r.value]));
      const perMonth = months.map((m) => ({ month: m, total: money(byMonth.get(m) ?? 0) }));
      const sum = perMonth.reduce((s, m) => s + m.total.paise, 0);
      return {
        period: periodOut(p),
        category: categoryName ?? null,
        months_counted: months.length,
        first_month: months[0],
        last_month: months.at(-1),
        total: money(sum),
        average: money(Math.round(sum / months.length)),
        months: perMonth,
      };
    },

    async aggregate(args) {
      const a = obj(args);
      if (!given(a.metric)) fail(`metric is required: one of ${METRICS.join(', ')}`);
      const metric = oneOf(a.metric, 'metric', METRICS);
      const p = period(a.period, now);
      const categoryName = category(a.category);
      const merchants = merchantList(a.merchants);
      const direction = oneOf(a.direction, 'direction', ['debit', 'credit'], undefined);
      const spendOnly = bool(a.spend_only, 'spend_only');
      const groupBy = oneOf(a.group_by, 'group_by', GROUPS, 'none');
      const order = oneOf(a.order, 'order', ['asc', 'desc'], undefined);
      const limit = int(a.limit, 'limit', { min: 1, max: 50, fallback: undefined });

      // combinations that can't mean anything: say why, so the model can retry
      if (metric !== 'count' && !spendOnly && !direction) {
        fail(`metric=${metric} needs spend_only=true or a direction: adding money in and money out together means nothing`);
      }
      if (spendOnly && direction === 'credit') fail('spend_only=true already means debits; drop direction=credit');
      if (spendOnly && NON_SPEND_CATEGORIES.includes(categoryName)) {
        fail(`${categoryName} is never spend; drop spend_only and use direction=debit instead`);
      }
      if (groupBy === 'category' && categoryName) fail('group_by=category with a category filter gives one group; drop one of them');
      if (groupBy === 'none' && (order || limit)) fail('order and limit only apply with group_by');
      if (groupBy === 'day' && daysIn(p) > MAX_DAY_GROUP_DAYS) fail(`group_by=day covers at most ${MAX_DAY_GROUP_DAYS} days; use group_by=month`);

      const m = await resolve(merchants);
      const filters = { period: p, category: categoryName, merchantNames: m.merchantNames, direction, spendOnly };
      const out = {
        period: periodOut(p),
        metric,
        filters: { category: categoryName ?? null, merchants: null, ...m.report, direction: direction ?? null, spend_only: spendOnly },
      };
      if (groupBy === 'none') {
        const r = await q.aggregate({ ...filters, metric });
        return { ...out, value: metricValue(metric, r.value), txn_count: r.count };
      }
      const rows = await q.aggregate({ ...filters, metric, groupBy, order, limit: limit ?? 50 });
      return {
        ...out,
        group_by: groupBy,
        groups: rows.map((r) => ({ key: r.key, value: metricValue(metric, r.value), txn_count: r.count })),
      };
    },
  };

  return {
    definitions: OPENAI_TOOLS,
    /** Runs a tool. Bad input comes back as { error } for the model to fix, never as a throw. */
    async run(name, args) {
      if (!Object.hasOwn(impl, name)) return { error: `unknown tool '${name}'` };
      try {
        return await impl[name](args ?? {});
      } catch (err) {
        if (err instanceof ToolInputError) return { error: err.message };
        throw err;
      }
    },
  };
}
