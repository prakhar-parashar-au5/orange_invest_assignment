// Rule-based categorisation. First match wins, so the order matters:
//   1. direction/channel-aware rules (salary and refund credits, ATM debits, self-transfers)
//   2. specific merchants before general ones (SWIGGY INSTAMART before SWIGGY, AMAZON PRIME before AMAZON)
// Keywords match whole words on an uppercased text where punctuation became spaces, so RENT doesn't
// match CURRENT and JIO doesn't match JIOMART.
import { isCategory } from '../categories.js';

const kw = (...words) => words;

/** @type {{ category: string, words: string[], direction?: 'debit'|'credit', channel?: string }[]} */
const RULES = [
  // direction / channel aware
  { category: 'Salary', direction: 'credit', words: kw('SALARY', 'SAL CREDIT', 'SAL CR', 'PAYROLL') },
  // A bounced ECS/NACH debit is a bank charge, not a refund (TE-003).
  { category: 'Bills & utilities', direction: 'debit', words: kw('ECS RETURN', 'BOUNCE', 'DISHONOUR', 'DISHONOURED') },
  { category: 'Refunds', direction: 'credit', words: kw('REFUND', 'REVERSAL', 'CASHBACK', 'CHARGEBACK') },
  // Payouts through a payment gateway: money from someone else, not income we can name (TE-003).
  { category: 'Transfers (others)', direction: 'credit', words: kw('RAZORPAY', 'SETTLEMENT') },
  { category: 'Cash withdrawal', direction: 'debit', channel: 'ATM', words: [] },
  { category: 'Cash withdrawal', direction: 'debit', words: kw('ATM', 'ATW', 'NWD', 'CASH WDL', 'CASH WITHDRAWAL') },
  { category: 'Self-transfer', words: kw('SELF', 'SELF TRANSFER', 'OWN A C', 'OWN ACCOUNT', 'OWN AC') },

  // specific before general
  { category: 'Groceries', words: kw('SWIGGY INSTAMART', 'INSTAMART') },
  { category: 'Entertainment', words: kw('AMAZON PRIME', 'PRIME VIDEO') },
  // Dominos: ordered through an app (UPI) it's delivery; paid at the counter (POS) it's dining.
  { category: 'Food delivery', channel: 'UPI', words: kw('DOMINOS') },

  { category: 'Food delivery', words: kw('SWIGGY', 'ZOMATO', 'EATSURE', 'FAASOS', 'BOX8') },
  {
    category: 'Groceries',
    words: kw('BIGBASKET', 'BIG BASKET', 'BLINKIT', 'GROFERS', 'ZEPTO', 'DMART', 'JIOMART', 'NATURES BASKET', 'MORE RETAIL', 'SPENCERS'),
  },
  {
    category: 'Dining',
    words: kw('STARBUCKS', 'CAFE', 'RESTAURANT', 'DOMINOS', 'MCDONALDS', 'KFC', 'PIZZA HUT', 'HALDIRAM', 'CHAAYOS', 'BARBEQUE NATION', 'BURGER KING', 'SUBWAY'),
  },
  {
    category: 'Shopping',
    words: kw('AMAZON', 'FLIPKART', 'MYNTRA', 'AJIO', 'NYKAA', 'MEESHO', 'TATA CLIQ', 'TATACLIQ', 'DECATHLON', 'CROMA', 'RELIANCE DIGITAL', 'IKEA'),
  },
  {
    category: 'Travel',
    words: kw('IRCTC', 'UBER', 'OLA', 'OLACABS', 'RAPIDO', 'MAKEMYTRIP', 'GOIBIBO', 'CLEARTRIP', 'INDIGO', 'AIR INDIA', 'VISTARA', 'AKASA', 'REDBUS', 'IXIGO', 'FASTAG'),
  },
  {
    category: 'Fuel',
    words: kw('PETROL', 'FUEL', 'HPCL', 'BPCL', 'IOCL', 'INDIAN OIL', 'BHARAT PETROLEUM', 'HINDUSTAN PETROLEUM', 'SHELL'),
  },
  { category: 'Rent', words: kw('RENT', 'NOBROKER', 'HOUSE RENT') },
  {
    category: 'EMI/loans',
    words: kw('EMI', 'LOAN', 'BAJAJ FINANCE', 'BAJAJ FINSERV', 'HOME CREDIT', 'TATA CAPITAL'),
  },
  {
    category: 'Investments',
    words: kw('SIP', 'MUTUAL FUND', 'MF', 'ZERODHA', 'GROWW', 'UPSTOX', 'KUVERA', 'COIN BY ZERODHA', 'BSE STAR', 'NSE CLEARING', 'PPF', 'NPS', 'ANGEL ONE', 'INDMONEY'),
  },
  {
    category: 'Insurance',
    words: kw('LIC', 'INSURANCE', 'POLICYBAZAAR', 'HDFC ERGO', 'ICICI LOMBARD', 'STAR HEALTH', 'ACKO', 'GO DIGIT', 'MAX LIFE', 'NIVA BUPA'),
  },
  {
    category: 'Health',
    words: kw('APOLLO', 'PHARMEASY', '1MG', 'TATA 1MG', 'NETMEDS', 'MEDPLUS', 'HOSPITAL', 'CLINIC', 'PRACTO', 'DIAGNOSTIC', 'PHARMACY', 'CULT FIT', 'CULTFIT'),
  },
  {
    category: 'Entertainment',
    words: kw('NETFLIX', 'SPOTIFY', 'HOTSTAR', 'DISNEY', 'BOOKMYSHOW', 'PVR', 'INOX', 'YOUTUBE PREMIUM', 'SONYLIV', 'ZEE5', 'JIOCINEMA', 'GAANA', 'STEAM'),
  },
  {
    category: 'Bills & utilities',
    words: kw('AIRTEL', 'JIO', 'VODAFONE', 'BSNL', 'ACT FIBERNET', 'BESCOM', 'MSEDCL', 'TATA POWER', 'ADANI ELECTRICITY', 'TORRENT POWER', 'ELECTRICITY', 'WATER BILL', 'MAHANAGAR GAS', 'INDANE', 'BILLDESK', 'RECHARGE', 'DTH', 'TATA PLAY', 'BROADBAND', 'POSTPAID', 'PREPAID', 'CRED CLUB', 'CREDIT CARD BILL'),
  },
];

for (const rule of RULES) {
  if (!isCategory(rule.category)) throw new Error(`rules.js: unknown category ${rule.category}`);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = RULES.map((rule) => ({
  ...rule,
  re: rule.words.length > 0 ? new RegExp(`(?:^| )(?:${rule.words.map(escape).join('|')})(?: |$)`) : null,
}));

/** Uppercase, every run of non-letters/digits → one space. Unicode-aware, so Hindi survives. */
export const normaliseText = (s) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();

/**
 * @param {{ merchant?: string|null, description?: string|null, direction: 'debit'|'credit', channel?: string }} txn
 * @returns {string|null} a category, or null when no rule applies
 */
export function ruleCategory({ merchant, description, direction, channel }) {
  const text = normaliseText(`${merchant ?? ''} ${description ?? ''}`);
  for (const rule of COMPILED) {
    if (rule.direction && rule.direction !== direction) continue;
    if (rule.channel && rule.channel !== channel) continue;
    if (rule.re === null) return rule.category; // a channel-only rule
    if (rule.re.test(text)) return rule.category;
  }
  return null;
}
