// Reads a bank narration ("UPI-SWIGGY-swiggy@icici-ICIC0000001-429183746512-Payment from Phone")
// and returns the channel, a reference number, the merchant (cleaned display name), and whether the
// payee looks like a private person (P2P).
//
// isPerson matters for privacy: a person's name is never sent to the LLM and never stored in the
// shared merchant cache (see categorise/index.js). When in doubt, a name counts as a person.

import { canonicalMerchant } from './merchant-names.js';
import { ruleCategory } from '../categorise/rules.js';

const PREFIX =
  /^(UPI|NEFT(?: CR| DR)?|RTGS(?: CR| DR)?|IMPS(?: CR| DR)?|POS|ME DC|CRV POS|ACH ?[DC]?|NACH(?: DR| CR)?|CHQ(?: PAID| DEP)?|CHEQUE|CLG|ATW|ATM|NWD|EAW)\b\s*/i;

// Payment-app prefixes (GPAY*DOMINOSBLR, PHONEPE SWIGGYBLR, PHONEPE*DMART). They mean UPI; the merchant follows.
const APP_PREFIX = /^(GPAY|PHONEPE|PAYTM|BHIM)(?:\s*\*\s*|\s+)/i;
// City codes apps glue onto the merchant (SWIGGYBLR → SWIGGY). Only stripped after an app prefix.
const GLUED_CITY = /^(\p{L}{3,}?)(BLR|DEL|MUM|HYD|CHN|PUN|KOL)$/u;
// Direction and rail tokens and narration filler: never part of a merchant name.
const NOISE_TOKENS = new Set(['DR', 'CR', 'P2A', 'P2M', 'IFT', 'MB', 'VPA', 'UTR', 'RRN', 'AUTH']);
const LEADING_APP_WORDS = new Set(['PAY', 'GPAY', 'PHONEPE', 'PAYTM', 'BHIM']);

const BANK_CODES = new Set(['SBIN', 'HDFC', 'ICIC', 'UTIB', 'KKBK', 'PUNB', 'BARB', 'CNRB', 'YESB', 'IDIB', 'UBIN', 'INDB', 'IDFB', 'CITI']);

// Words that mark a business. If any appears, the payee is not a person.
const BUSINESS_WORDS = new Set(
  `LTD LIMITED PVT PRIVATE LLP INC CORP CORPORATION CO COMPANY STORE STORES ENTERPRISES ENTERPRISE
   TRADERS TRADING MART SHOP SHOPPE RESTAURANT CAFE HOTEL HOTELS MEDICAL MEDICALS PHARMA PHARMACY
   AGENCY AGENCIES SERVICES SERVICE SOLUTIONS TECHNOLOGIES TECHNOLOGY TECH INDIA FOODS FOOD BAKERY
   BAKERS KIRANA GENERAL CENTRE CENTER MOTORS AUTO SWEETS DAIRY FRESH SUPERMARKET HOSPITAL CLINIC
   INDUSTRIES INTERNATIONAL GROUP RETAIL ONLINE PAYMENTS PAY BANK FINANCE CAPITAL INSURANCE TRUST
   SCHOOL COLLEGE ACADEMY CLUB GYM SALON STUDIO TRAVELS TOURS PETROL FUEL STATION COFFEE MOBILITY
   PAYMENT VENDOR SOFTWARE SOFTWAR CLIENT SETTLEMENT LOGISTICS VENTURES SYSTEMS TRANSFER SELF`.split(/\s+/),
);
// Stems that mark a business even inside one word (FRESHMART, CITYCAB, BLUEBOTTLE COFFEE).
const BUSINESS_STEMS = /(MART|STORE|CAFE|COFFEE|BAKER|FOODS|PHARMA|MEDIC|TRADER|CABS?$|TECH|SOFT)/;

const TRANSFER_CHANNELS = new Set(['UPI', 'IMPS', 'NEFT', 'RTGS']);

/** A word the rules already know as a brand or keyword (SWIGGY, DMART, RAZORPAY, RENT…). */
const isKnownBrand = (word) =>
  ruleCategory({ merchant: word, description: word, direction: 'debit', channel: 'OTHER' }) !== null ||
  ruleCategory({ merchant: word, description: word, direction: 'credit', channel: 'OTHER' }) !== null;

function channelOf(upper) {
  if (/^UPI\b/.test(upper) || APP_PREFIX.test(upper)) return 'UPI';
  if (/^NEFT\b/.test(upper)) return 'NEFT';
  if (/^RTGS\b/.test(upper)) return 'RTGS';
  if (/^IMPS\b/.test(upper)) return 'IMPS';
  if (/^(ATW|ATM|NWD|EAW)\b/.test(upper) || /\b(ATM WDL|CASH WDL)\b/.test(upper)) return 'ATM';
  if (/^(POS|ME DC|CRV POS|PCD)\b/.test(upper) || /\bDEBIT CARD\b/.test(upper)) return 'CARD';
  if (/^(CHQ|CHEQUE|CLG)\b/.test(upper)) return 'CHEQUE';
  if (/^CASH\b/.test(upper)) return 'CASH';
  return 'OTHER';
}

const isIfsc = (t) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(t);
const isMasked = (t) => /^[X\d*]*[X*]{2,}[X\d*]*$/.test(t);
const isRefLike = (t) => /^\d+$/.test(t) || (/\d/.test(t) && /\p{L}/u.test(t) && t.length >= 6);

/** Keeps the words of a segment that can be part of a name. */
function cleanSegment(segment) {
  const words = segment
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => t && !isIfsc(t) && !isMasked(t) && !isRefLike(t) && !NOISE_TOKENS.has(t));
  while (words.length > 1 && LEADING_APP_WORDS.has(words[0])) words.shift();
  if (words.length === 0) return null;
  if (words.length === 1 && BANK_CODES.has(words[0])) return null;
  // Unicode-aware: Hindi (letters plus combining vowel signs) and accented names survive.
  const text = words.join(' ').replace(/[^\p{L}\p{M}\p{N}&.' ]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(text) ? text : null;
}

// CAFÉ → CAFE, so accented business words still count. Devanagari words just lose their vowel
// signs here, which only affects this comparison.
const withoutAccents = (w) => w.normalize('NFD').replace(/\p{M}/gu, '');

const titleCase = (s) =>
  s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/**
 * Privacy first: on a person-to-person rail (UPI/IMPS/NEFT/RTGS), 1–4 plain words with no business
 * word, business stem or known brand count as a person, including a single first name ("Rahul").
 */
export function looksLikePerson(merchantUpper, _vpa, channel) {
  if (!merchantUpper || !TRANSFER_CHANNELS.has(channel)) return false;
  const words = merchantUpper.split(' ');
  if (words.length > 4) return false;
  if (!words.every((w) => /^[\p{L}\p{M}]+$/u.test(w))) return false;
  const plain = words.map(withoutAccents);
  return !plain.some((w) => BUSINESS_WORDS.has(w) || BUSINESS_STEMS.test(w) || isKnownBrand(w));
}

/** 'rahul.k@paytm' → 'RAHUL K'. A phone-number handle gives nothing. */
function nameFromVpa(vpa) {
  const local = vpa.split('@')[0].replace(/[^\p{L}]+/gu, ' ').trim().toUpperCase();
  return local.length >= 2 ? local : null;
}

/** If the VPA handle spells the first words of the name, keep only those: FRESHMART INDIRANAGAR + freshmart@… → FRESHMART. */
function trimToVpa(nameUpper, vpa) {
  if (!nameUpper || !vpa) return nameUpper;
  const handle = vpa.split('@')[0].replace(/[^a-z]/gi, '').toUpperCase();
  const words = nameUpper.split(' ');
  for (let k = 1; k < words.length; k += 1) {
    if (words.slice(0, k).join('') === handle) return words.slice(0, k).join(' ');
  }
  return nameUpper;
}

/**
 * @param {string} description
 * @param {string|null} [refColumn] the Chq./Ref.No. cell, if the format has one
 * @returns {{ channel: string, ref: string|null, merchant: string|null, isPerson: boolean }}
 */
export function parseNarration(description, refColumn = null) {
  let text = String(description ?? '').trim();
  const channel = channelOf(text.toUpperCase());
  const viaApp = APP_PREFIX.test(text);
  if (viaApp) text = text.replace(APP_PREFIX, '');

  const segments = text.split(/\s*[-/]\s*/);
  segments[0] = segments[0].replace(PREFIX, '');

  let vpa = null;
  let refFromText = null;
  let merchantUpper = null;
  for (const seg of segments) {
    const s = seg.trim();
    if (!s) continue;
    if (s.includes('@')) {
      // A VPA on its own, or inside a segment with other words ("FRESHMART INDIRANAGAR VPA x@okicici UTR …")
      const tokens = s.split(/\s+/);
      vpa ??= tokens.find((t) => t.includes('@')).toLowerCase();
      const rest = tokens.filter((t) => !t.includes('@')).join(' ');
      if (rest && merchantUpper == null && channel !== 'ATM') merchantUpper = trimToVpa(cleanSegment(rest), vpa);
      continue;
    }
    if ((channel === 'UPI' || channel === 'IMPS') && /^\d{12}$/.test(s)) {
      refFromText ??= s;
      continue;
    }
    if (channel === 'ATM') continue; // ATM narrations name a location, not a merchant
    if (merchantUpper == null) merchantUpper = cleanSegment(s);
  }

  if (merchantUpper && viaApp) merchantUpper = merchantUpper.split(' ').map((w) => w.replace(GLUED_CITY, '$1')).join(' ');
  // UPI with no name: the VPA handle is the payee (rahul@paytm → Rahul).
  if (!merchantUpper && vpa && channel !== 'ATM') merchantUpper = nameFromVpa(vpa);

  const refCell = String(refColumn ?? '').trim();
  const ref = refCell && !/^0+$/.test(refCell) ? refCell.slice(0, 64) : refFromText;

  const isPerson = looksLikePerson(merchantUpper, vpa, channel);
  // Businesses get their canonical name (Zomato Ltd → Zomato); people keep theirs as written.
  const display = merchantUpper && (isPerson ? titleCase(merchantUpper) : canonicalMerchant(merchantUpper));
  return { channel, ref, merchant: display ? display.slice(0, 120) : null, isPerson };
}
