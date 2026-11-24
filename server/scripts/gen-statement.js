// Synthetic bank statement generator. Every name, number and ref is made up.
//
//   node scripts/gen-statement.js --seed 1 --months 14 --out statement.csv [--end YYYY-MM-DD]
//
// The output uses the HDFC-like layout from src/ingest/formats.js. It is deterministic for a given
// (seed, months, end); `end` defaults to today in IST. "Last month" means the calendar month before
// `end`'s month. The data is built so the 10 golden questions all have clear answers:
//   - salary on the 1st, plus rent, EMI, SIP, Netflix, Spotify, Airtel and electricity every month
//   - food delivery (Swiggy, Zomato), groceries, fuel, IRCTC, Uber, dining, shopping, health
//   - a monthly self-transfer and SIP (not spend), ATM withdrawals, P2P payments, the odd refund
//   - unknown small businesses that no rule knows, for the LLM fallback
//   - a travel spike last month, so it is clearly higher than the month before
//   - one clear largest expense (a laptop) 4 months back
//   - several debits above ₹5,000 in the last 30 days
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HEADER = 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance';
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const OPENING_BALANCE = 30000000; // ₹3,00,000

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return {
    int,
    pick: (arr) => arr[int(0, arr.length - 1)],
    chance: (p) => next() < p,
    /** a rupee amount in [min, max], in paise; whole rupees unless `paise` is true */
    rupees: (min, max, { paise = false } = {}) => int(min, max) * 100 + (paise ? int(0, 99) : 0),
    digits: (n) => Array.from({ length: n }, (_, i) => (i === 0 ? int(1, 9) : int(0, 9))).join(''),
  };
}

export function todayIst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addMonths(y, m, delta) {
  const idx = y * 12 + (m - 1) + delta;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}
function addDays(date, delta) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const ddmmyy = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(2, 4)}`;
const money = (paise) => `${Math.floor(paise / 100)}.${pad(paise % 100)}`;

export function generateStatement({ seed = 1, months = 14, end = todayIst() } = {}) {
  const r = rng(seed);
  const [endY, endM] = [Number(end.slice(0, 4)), Number(end.slice(5, 7))];
  const events = [];
  const add = (date, description, paise, direction, ref = null) => {
    if (date > end) return;
    events.push({ date, description, paise, direction, ref, seq: events.length });
  };

  const upiRef = () => r.digits(12);
  const upi = (name, vpa, note) => {
    const ref = upiRef();
    return [`UPI-${name}-${vpa}-${r.pick(['HDFC0000001', 'ICIC0000001', 'SBIN0001234', 'UTIB0000123'])}-${ref}-${note}`, ref.padStart(16, '0')];
  };
  const card = () => `${r.pick(['512345', '438857', '461786'])}XXXXXX${pad(r.int(10, 99))}${pad(r.int(10, 99))}`;
  const addUpi = (date, name, vpa, note, paise, direction) => {
    const [description, ref] = upi(name, vpa, note);
    add(date, description, paise, direction, ref);
  };

  for (let k = months - 1; k >= 0; k -= 1) {
    const [y, m] = addMonths(endY, endM, -k);
    const last = daysIn(y, m);
    const day = (d) => ymd(y, m, Math.min(d, last));
    const rand = () => day(r.int(1, last));
    const mon = `${MON[m - 1]} ${String(y).slice(2)}`;

    // income and fixed monthly payments
    add(day(1), `NEFT CR-HDFC0000123-ACME TECHNOLOGIES PVT LTD-SALARY ${mon}-HDFCN${y}${pad(m)}01${r.digits(5)}`, 12500000, 'credit');
    {
      const ref = r.digits(12);
      add(day(3), `IMPS-${ref}-SURESH KUMAR-SBIN-XXXXXX4521-RENT ${MON[m - 1]}`, 2800000, 'debit', ref.padStart(16, '0'));
    }
    add(day(5), `ACH D- BAJAJ FINANCE LTD-BFL${r.digits(10)}`, 1245000, 'debit');
    add(day(7), `ACH D- ICICI PRUDENTIAL MF SIP-ICPMF${r.digits(8)}`, 1000000, 'debit');
    add(day(12), `POS ${card()} NETFLIX.COM`, 64900, 'debit');
    addUpi(day(14), 'BESCOM', 'bescom@billdesk', 'Electricity bill', r.rupees(1100, 2600), 'debit');
    add(day(16), `IMPS-${r.digits(12)}-SELF TRANSFER-HDFC-XXXXXX7788-TO OWN A/C`, 1500000, 'debit');
    addUpi(day(18), 'SPOTIFY INDIA', 'spotify.mandate@hdfcbank', 'Autopay', 11900, 'debit');
    addUpi(day(20), 'AIRTEL', 'airtelpostpaid@icici', 'Bill payment', 79900, 'debit');

    // variable spend
    const repeat = (min, max, fn) => {
      const n = r.int(min, max);
      for (let i = 0; i < n; i += 1) fn();
    };
    const upiSpend = (min, max, name, vpa, note, range, opts) =>
      repeat(min, max, () => {
        const [d, ref] = upi(name, vpa, note);
        add(rand(), d, r.rupees(range[0], range[1], opts), 'debit', ref);
      });

    upiSpend(5, 9, 'SWIGGY', 'swiggy@icici', 'Payment from Phone', [180, 950], { paise: true });
    upiSpend(3, 6, 'ZOMATO LTD', 'zomato@hdfcbank', 'food order', [200, 900], { paise: true });
    upiSpend(1, 2, 'BIGBASKET', 'bigbasket@razorpay', 'groceries', [900, 3200], { paise: true });
    upiSpend(2, 4, 'BLINKIT', 'blinkit@hdfcbank', 'groceries', [250, 1200]);
    upiSpend(1, 3, 'ZEPTO', 'zepto@ybl', 'groceries', [200, 900]);
    upiSpend(2, 5, 'UBER INDIA', 'uber@axisbank', 'ride', [150, 600]);
    upiSpend(1, 3, 'STARBUCKS', 'starbucks@icici', 'coffee', [350, 750]);
    upiSpend(1, 3, 'AMAZON PAY', 'amazon@apl', 'order', [400, 4500], { paise: true });
    upiSpend(0, 1, 'APOLLO PHARMACY', 'apollo@icici', 'medicines', [250, 1500], { paise: true });
    repeat(2, 2, () => add(rand(), `POS ${card()} ${r.pick(['HPCL PETROL PUMP', 'INDIAN OIL FUEL STN'])}`, r.rupees(1500, 3000), 'debit'));
    if (r.chance(0.6)) {
      const [d, ref] = upi('IRCTC', 'irctc@sbi', 'train ticket');
      add(rand(), d, r.rupees(650, 2400, { paise: true }), 'debit', ref);
    }
    repeat(1, 1, () => add(rand(), `ATW-${card()}-${r.pick(['MG ROAD BANGALORE', 'KORAMANGALA BLR', 'INDIRANAGAR BLR'])}`, r.int(4, 10) * 50000, 'debit'));

    // person-to-person
    const friends = [
      ['RAHUL SHARMA', '9876543210@ybl'],
      ['PRIYA NAIR', 'priya.nair@okaxis'],
      ['ANKIT VERMA', 'ankitv@okhdfcbank'],
    ];
    repeat(1, 3, () => {
      const [name, vpa] = r.pick(friends);
      const [d, ref] = upi(name, vpa, r.pick(['dinner split', 'movie', 'trip share', 'UPI']));
      add(rand(), d, r.rupees(200, 2000), 'debit', ref);
    });
    if (r.chance(0.4)) {
      const [name, vpa] = r.pick(friends);
      const [d, ref] = upi(name, vpa, 'returned');
      add(rand(), d, r.rupees(300, 1500), 'credit', ref);
    }

    // small businesses no rule knows: these exercise the LLM fallback
    const unknown = [
      ['SHREE GANESH TRADERS', 'shreeganesh@ybl'],
      ['NEW BALAJI MEDICALS', 'balajimed@okicici'],
      ['SRI SAI ENTERPRISES', 'srisai.ent@ybl'],
      ['MAHALAXMI GENERAL STORE', 'mahalaxmi.store@ybl'],
      ['ROYAL BAKERS', 'royalbakers@paytm'],
    ];
    repeat(2, 4, () => {
      const [name, vpa] = r.pick(unknown);
      const [d, ref] = upi(name, vpa, 'UPI');
      add(rand(), d, r.rupees(150, 1800), 'debit', ref);
    });

    if (r.chance(0.3)) {
      const [d, ref] = upi('AMAZON PAY', 'amazon@apl', 'REFUND');
      add(rand(), d, r.rupees(300, 2000), 'credit', ref);
    }
  }

  // last month's travel spike
  {
    const [y, m] = addMonths(endY, endM, -1);
    const [d1, ref1] = upi('MAKEMYTRIP', 'makemytrip@icici', 'Goa holiday package');
    add(ymd(y, m, 9), d1, 2450000, 'debit', ref1);
    add(ymd(y, m, 10), `POS ${card()} INDIGO AIRLINES`, 1380000, 'debit');
    const [d2, ref2] = upi('IRCTC', 'irctc@sbi', 'train ticket');
    add(ymd(y, m, 22), d2, 412000, 'debit', ref2);
  }
  // the single largest expense
  if (months >= 5) {
    const [y, m] = addMonths(endY, endM, -4);
    add(ymd(y, m, 15), `POS ${card()} CROMA RETAIL`, 8499000, 'debit');
  }
  // big spends in the last 30 days
  {
    const [d1, ref1] = upi('AMAZON PAY', 'amazon@apl', 'order');
    add(addDays(end, -6), d1, 749900, 'debit', ref1);
    const [d2, ref2] = upi('IRCTC', 'irctc@sbi', 'train ticket');
    add(addDays(end, -12), d2, 564000, 'debit', ref2);
    add(addDays(end, -2), `POS ${card()} DECATHLON SPORTS`, 618000, 'debit');
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));

  let balance = OPENING_BALANCE;
  const lines = [HEADER];
  for (const e of events) {
    balance += e.direction === 'credit' ? e.paise : -e.paise;
    const date = ddmmyy(e.date);
    lines.push(
      [
        date,
        e.description,
        e.ref ?? '0000000000000000',
        date,
        e.direction === 'debit' ? money(e.paise) : '',
        e.direction === 'credit' ? money(e.paise) : '',
        money(balance),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const seed = Number(argValue('seed', '1'));
  const months = Number(argValue('months', '14'));
  const end = argValue('end', todayIst());
  const out = argValue('out', null);
  if (!Number.isInteger(seed) || !Number.isInteger(months) || months < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    console.error('usage: node scripts/gen-statement.js --seed N --months 14 --out file.csv [--end YYYY-MM-DD]');
    process.exit(1);
  }
  const csv = generateStatement({ seed, months, end });
  if (out) {
    writeFileSync(out, csv);
    const rows = csv.trim().split('\n').length - 1;
    console.log(`wrote ${out}: ${rows} rows, seed ${seed}, ${months} months ending ${end}, sha256 ${createHash('sha256').update(csv).digest('hex')}`);
  } else {
    process.stdout.write(csv);
  }
}
