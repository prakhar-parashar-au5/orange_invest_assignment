// Parses an Indian bank-statement amount into integer paise using only string and integer
// operations, never floats. That way "4.35" is exactly 435 paise, not 434.99999.
//
// Accepted forms: 1,23,456.78 | 123,456.78 | 1234 | 1234.5 | ₹ 500 | Rs. 500 | INR 500
//                 -250 | +250 | (250.00) | 250.00 Dr | 250.00 Cr
// Returns { paise, sign } with sign -1 for negative/Dr/parenthesised forms, otherwise 1.
// An empty cell returns null. Anything else throws.

const SHAPE = /^(\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

export function parseMoney(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === '') return null;

  let sign = 1;
  const fail = () => {
    throw new Error(`Unparseable amount '${String(input).trim()}'`);
  };

  const suffix = s.match(/\s*(DR|CR)\.?$/i);
  if (suffix) {
    if (suffix[1].toUpperCase() === 'DR') sign = -1;
    s = s.slice(0, suffix.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    sign = -sign;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(₹|INR|RS\.?)\s*/i, '');
  if (s.startsWith('-') || s.startsWith('+')) {
    if (s.startsWith('-')) sign = -sign;
    s = s.slice(1).trim();
  }
  s = s.replace(/^(₹|INR|RS\.?)\s*/i, '');

  const m = s.match(SHAPE);
  if (!m) fail();
  const rupees = m[1].replace(/,/g, '');
  const fraction = (m[2] ?? '').padEnd(2, '0');
  const paise = Number(rupees) * 100 + Number(fraction);
  if (!Number.isSafeInteger(paise)) fail();
  return { paise, sign };
}
