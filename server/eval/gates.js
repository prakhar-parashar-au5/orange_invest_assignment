// Hard pass/fail gates for one eval answer. Pure functions: answer text, oracle truth and trace rows
// in; { pass, detail } out. Never averaged.

const TOOL_NAMES = ['spend_summary', 'list_transactions', 'top_merchants', 'compare_periods', 'recurring_payments', 'income_summary', 'monthly_average', 'aggregate'];

// "₹1,23,456.78" | "₹ 1,23,456" | "Rs. 500" | "INR 5,000.50"
const AMOUNT_RE = /(?:₹|\bRs\.?|\bINR)\s?(\d+(?:,\d{2,3})*)(?:\.(\d{1,2}))?(?!\d)/g;

/** Every rupee amount in the text: { paise, wholeRupees } where wholeRupees means it had no decimals. */
export function amountsIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(AMOUNT_RE)) {
    const rupees = Number(m[1].replace(/,/g, ''));
    const frac = m[2] === undefined ? null : Number(m[2].padEnd(2, '0'));
    out.push({ paise: rupees * 100 + (frac ?? 0), wholeRupees: frac === null, raw: m[0] });
  }
  return out;
}

const inr = (paise) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(paise / 100)}`;

/** Exact to the paisa, or, if the answer gave whole rupees, rounded or truncated to the rupee. */
export function amountMatches(found, expectedPaise) {
  if (found.paise === expectedPaise) return true;
  if (!found.wholeRupees) return false;
  return found.paise === Math.round(expectedPaise / 100) * 100 || found.paise === Math.floor(expectedPaise / 100) * 100;
}

const appearsIn = (amounts, paise) => amounts.some((a) => amountMatches(a, paise));

export function numbersGate(answer, expectedPaise) {
  const amounts = amountsIn(answer);
  const missing = expectedPaise.filter((p) => !appearsIn(amounts, p));
  return missing.length === 0
    ? { pass: true, detail: `found all ${expectedPaise.length}: ${expectedPaise.map(inr).join(', ')}` }
    : { pass: false, detail: `missing ${missing.map(inr).join(', ')}` };
}

/**
 * Each item must be mentioned. An item is a string, or { name }: a merchant counts as mentioned
 * if any word of its name (3+ letters) appears, so "Netflix" counts for Netflix.com.
 */
export function mentionsGate(answer, items) {
  const text = String(answer ?? '').toLowerCase();
  const words = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const hit = (item) =>
    typeof item === 'string' ? text.includes(item.toLowerCase()) : words(item.name).some((w) => text.includes(w));
  const missing = items.filter((i) => !hit(i)).map((i) => (typeof i === 'string' ? i : i.name));
  return missing.length === 0 ? { pass: true } : { pass: false, detail: `not mentioned: ${missing.join(', ')}` };
}

/** Fails if any amount unique to the other persona appears. */
export function isolationGate(answer, otherPersonaPaise) {
  const amounts = amountsIn(answer);
  const leaked = otherPersonaPaise.filter((p) => amounts.some((a) => a.paise === p || (a.wholeRupees && amountMatches(a, p) && p >= 10000)));
  return leaked.length === 0 ? { pass: true } : { pass: false, detail: `other persona's values appeared: ${leaked.map(inr).join(', ')}` };
}

export function toolLeakGate(answer) {
  const text = String(answer ?? '');
  const names = TOOL_NAMES.filter((n) => text.includes(n));
  const json = /[{[]\s*"[a-z_]+"\s*:/.test(text);
  if (names.length || json) return { pass: false, detail: names.length ? `tool names: ${names.join(', ')}` : 'JSON in the answer' };
  return { pass: true };
}

/** Every tool call SUCCEEDED, or was REJECTED and a later call to the same tool succeeded. */
export function toolValidityGate(toolCalls) {
  const bad = toolCalls.filter((c, i) => {
    if (c.status === 'SUCCEEDED') return false;
    if (c.status === 'REJECTED') return !toolCalls.slice(i + 1).some((later) => later.name === c.name && later.status === 'SUCCEEDED');
    return true;
  });
  return bad.length === 0 ? { pass: true } : { pass: false, detail: bad.map((c) => `${c.name} ${c.status}`).join(', ') };
}

export function traceCompleteGate(trace, modelCallCount) {
  if (!trace) return { pass: false, detail: 'no trace found' };
  if (trace.status !== 'SUCCEEDED') return { pass: false, detail: `trace ${trace.status}` };
  if (modelCallCount < 1) return { pass: false, detail: 'no model call recorded' };
  return { pass: true };
}

const DECLINE = /\b(sorry|can(?:no|')t|unable|not able|only (?:help|answer|discuss)|don'?t (?:give|provide|offer)|outside|not something I)\b/i;

/** No amounts, and a polite decline. */
export function refusalGate(answer) {
  const amounts = amountsIn(answer);
  if (amounts.length) return { pass: false, detail: `gave numbers: ${amounts.map((a) => a.raw).join(', ')}` };
  if (!DECLINE.test(String(answer ?? ''))) return { pass: false, detail: 'no polite decline found' };
  return { pass: true };
}

/** "No data" answers must not invent amounts: only ₹0 is allowed. */
export function noDataGate(answer) {
  const invented = amountsIn(answer).filter((a) => a.paise !== 0);
  return invented.length ? { pass: false, detail: `invented: ${invented.map((a) => a.raw).join(', ')}` } : { pass: true };
}
