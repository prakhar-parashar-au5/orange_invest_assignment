// Bank statements print the calendar date in IST. We keep that calendar date as-is (YYYY-MM-DD) and
// never route it through a JS Date in local time, so it can't shift by a day.
//
// Accepted: DD/MM/YY, DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD-Mon-YYYY, DD Mon YYYY,
//           DD-MON-YY, YYYY-MM-DD, plus an optional trailing time ("14/10/2026 10:22:01").
// Two-digit years are 20YY.

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

const pad = (n) => String(n).padStart(2, '0');

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidYmd(year, month, day) {
  return year >= 1900 && year <= 2999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseDate(input) {
  const raw = String(input ?? '').trim();
  const s = raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i, '');
  const fail = () => {
    throw new Error(`Unparseable date '${raw}'`);
  };

  let year;
  let month;
  let day;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2}|\d{4})$/))) {
    day = Number(m[1]);
    month = MONTHS[m[2].toUpperCase()];
    year = Number(m[3]);
    if (!month) fail();
  } else {
    fail();
  }
  if (year < 100) year += 2000;
  if (!isValidYmd(year, month, day)) fail();
  return `${year}-${pad(month)}-${pad(day)}`;
}
