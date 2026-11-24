// Periods are resolved here, on the server, never by the LLM. The model passes a period token and
// gets back exact IST dates in every tool result.
//
//   today | yesterday | this_week (Monday to today) | this_month | last_month | this_year | last_year | all_time
//   last_N_days     the N days ending today, today included          (1–3660)
//   last_N_months   the N complete calendar months before this one   (1–120)
//   months_ago:N    one calendar month: 0 = this month, 1 = last month, 2 = the month before last
//   month:YYYY-MM | year:YYYY | range:YYYY-MM-DD..YYYY-MM-DD
//   month_name:<name>  a month named without a year: the most recent one that has already started
//                      (asked in November, "October" is this year's, "December" is last year's)
// A period that has started but not ended stops at today.
import moment from 'moment-timezone';

export const TZ = 'Asia/Kolkata';
const FMT = 'YYYY-MM-DD';
const ALL_TIME_FROM = '1900-01-01';

const MONTH_NAMES = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];

export const PERIOD_HELP =
  'Use one of: today, yesterday, this_week, this_month, last_month, this_year, last_year, all_time, last_N_days, last_N_months, ' +
  'months_ago:N, month:YYYY-MM, year:YYYY, month_name:<name>, range:YYYY-MM-DD..YYYY-MM-DD';

const invalid = (period, why) => new Error(`Invalid period '${period}': ${why}. ${PERIOD_HELP}`);

const ist = (now) => moment(now).tz(TZ);
export const todayIst = (now = moment()) => ist(now).format(FMT);

function strictDate(s) {
  const m = moment.tz(s, FMT, true, TZ);
  return m.isValid() ? m : null;
}

function label(from, to) {
  const f = moment.tz(from, FMT, TZ);
  const t = moment.tz(to, FMT, TZ);
  if (from === ALL_TIME_FROM) return 'all time';
  if (f.date() === 1 && t.isSame(f.clone().endOf('month'), 'day')) return f.format('MMMM YYYY');
  if (from === to) return f.format('D MMM YYYY');
  return `${f.format('D MMM YYYY')} – ${t.format('D MMM YYYY')}`;
}

/** One calendar month; a month that is under way stops at today. */
function month(start, today) {
  const endOfMonth = start.clone().endOf('month').startOf('day');
  const end = start.isAfter(today) ? endOfMonth : moment.min(endOfMonth, today);
  return [start.format(FMT), end.format(FMT)];
}

/**
 * @param {string} period
 * @param {moment.Moment|Date} [now]
 * @returns {{ period: string, from: string, to: string, label: string }}
 */
export function resolvePeriod(period, now = moment()) {
  if (typeof period !== 'string' || period.trim() === '') throw invalid(period, 'missing');
  const p = period.trim();
  const today = ist(now).startOf('day');
  const thisMonth = today.clone().startOf('month');
  let m;
  let range;

  if (p === 'this_month') range = month(thisMonth, today);
  else if (p === 'today') range = [today.format(FMT), today.format(FMT)];
  else if (p === 'yesterday') {
    const y = today.clone().subtract(1, 'day').format(FMT);
    range = [y, y];
  } else if (p === 'this_week') range = [today.clone().startOf('isoWeek').format(FMT), today.format(FMT)];
  else if (p === 'last_month') range = month(thisMonth.clone().subtract(1, 'month'), today);
  else if (p === 'this_year') range = [today.clone().startOf('year').format(FMT), today.format(FMT)];
  else if (p === 'last_year') {
    const y = today.year() - 1;
    range = [`${y}-01-01`, `${y}-12-31`];
  } else if (p === 'all_time') range = [ALL_TIME_FROM, today.format(FMT)];
  else if ((m = p.match(/^last_(\d+)_days$/))) {
    const n = Number(m[1]);
    if (n < 1 || n > 3660) throw invalid(p, 'N must be 1–3660');
    range = [today.clone().subtract(n - 1, 'days').format(FMT), today.format(FMT)];
  } else if ((m = p.match(/^last_(\d+)_months$/))) {
    const n = Number(m[1]);
    if (n < 1 || n > 120) throw invalid(p, 'N must be 1–120');
    range = [thisMonth.clone().subtract(n, 'months').format(FMT), thisMonth.clone().subtract(1, 'day').format(FMT)];
  } else if ((m = p.match(/^months_ago:(\d+)$/))) {
    const n = Number(m[1]);
    if (n > 120) throw invalid(p, 'N must be 0–120');
    range = month(thisMonth.clone().subtract(n, 'months'), today);
  } else if ((m = p.match(/^month:(\d{4}-\d{2})$/))) {
    const start = strictDate(`${m[1]}-01`);
    if (!start) throw invalid(p, 'not a real month');
    range = month(start, today);
  } else if ((m = p.match(/^year:(\d{4})$/))) {
    range = [`${m[1]}-01-01`, `${m[1]}-12-31`];
  } else if ((m = p.match(/^month_name:([a-z]+)$/i))) {
    const idx = MONTH_NAMES.findIndex((names) => names.includes(m[1].toLowerCase()));
    if (idx === -1) throw invalid(p, 'unknown month name');
    let start = today.clone().month(idx).startOf('month');
    if (start.isAfter(today)) start = start.subtract(1, 'year');
    range = month(start, today);
  } else if ((m = p.match(/^range:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/))) {
    const [a, b] = [strictDate(m[1]), strictDate(m[2])];
    if (!a || !b) throw invalid(p, 'not real dates');
    if (a.isAfter(b)) throw invalid(p, 'start is after end');
    range = [m[1], m[2]];
  } else {
    throw invalid(p, 'unknown period');
  }

  return { period: p, from: range[0], to: range[1], label: label(range[0], range[1]) };
}

/** Calendar months (YYYY-MM) that lie wholly inside the period and have already ended. */
export function completeMonths({ from, to }, now = moment()) {
  const today = ist(now).startOf('day');
  const out = [];
  const end = moment.tz(to, FMT, TZ);
  for (let m = moment.tz(from, FMT, TZ).startOf('month'); !m.isAfter(end); m.add(1, 'month')) {
    const first = m.clone().startOf('month');
    const last = m.clone().endOf('month').startOf('day');
    if (first.format(FMT) >= from && last.format(FMT) <= to && last.isBefore(today)) out.push(m.format('YYYY-MM'));
  }
  return out;
}
