// One merchant, one name. Applied at ingest so `merchant` is stored canonical, and to the merchant
// names the agent's tools are asked about, so "Zomato Ltd" and "Zomato" match the same rows.
//
//   1. an exact alias (for shops whose variants differ by more than a suffix)
//   2. strip trailing legal and payment words (Ltd, Pvt, India, Pay…), never down to nothing
//   3. the alias map again on what's left
// "Swiggy Instamart" stays apart from "Swiggy": a different merchant and a different category.

const ALIASES = new Map([
  ['AMAZON IN', 'AMAZON'],
  ['AMAZON SELLER SERVICES', 'AMAZON'],
  ['AMAZON RETAIL', 'AMAZON'],
  ['ZOMATO MEDIA', 'ZOMATO'],
  ['BUNDL TECHNOLOGIES', 'SWIGGY'], // Swiggy's legal name
  ['FLIPKART INTERNET', 'FLIPKART'],
  ['RAZORPAY BIGBASKET', 'BIGBASKET'],
  ['SUPERMARKET GROCERY SUPPLIES', 'BIGBASKET'], // BigBasket's legal name
]);

const SUFFIXES = new Set(['LTD', 'LIMITED', 'PVT', 'PRIVATE', 'INDIA', 'PAY', 'PAYMENTS', 'ONLINE', 'TECHNOLOGIES']);

const titleCase = (s) =>
  s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/** Canonical key form: uppercase, punctuation → spaces, single spaces. Unicode-aware. */
export const merchantUpper = (name) =>
  String(name ?? '')
    .toUpperCase()
    .replace(/[^\p{L}\p{M}\p{N}&.' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The canonical uppercase form, e.g. 'ZOMATO LTD' → 'ZOMATO'. */
export function canonicalUpper(name) {
  let s = merchantUpper(name);
  if (!s) return null;
  s = ALIASES.get(s) ?? s;
  const words = s.split(' ');
  while (words.length > 1 && SUFFIXES.has(words.at(-1))) words.pop();
  s = words.join(' ');
  return ALIASES.get(s) ?? s;
}

/** The canonical display name, e.g. 'AMAZON PAY INDIA' → 'Amazon'. */
export function canonicalMerchant(name) {
  const upper = canonicalUpper(name);
  return upper ? titleCase(upper) : null;
}
