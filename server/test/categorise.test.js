import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createCategoriser, merchantKey } from '../src/categorise/index.js';
import { testConfig } from './helpers.js';
import { createPool } from '../src/db.js';

// merchant_categories is shared by all users, and test files run in parallel, so every test uses
// merchant names nobody else uses.
const unknownMerchant = (label) => `Zqx ${label} Traders ${randomUUID().slice(0, 8)}`;
const debit = (merchant, description = `UPI/${merchant}/1234567890/pay`) => ({
  merchant,
  description,
  direction: 'debit',
  channel: 'UPI',
});

let db;
beforeAll(() => {
  db = createPool(testConfig().databaseUrl);
});
afterAll(() => db.end());

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

/** A mock classifier that answers each name from a map (or a fixed answer). */
function fakeClassifier(answer) {
  return {
    classify: vi.fn(async (names) => names.map((n) => (typeof answer === 'function' ? answer(n) : answer))),
  };
}

describe('createCategoriser', () => {
  it('uses rules first and never calls the LLM for rule hits', async () => {
    const classifier = fakeClassifier('Shopping');
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    const result = await categoriser.categorise([debit('Swiggy'), debit('Netflix'), debit('Zerodha')]);

    expect(result).toEqual(['Food delivery', 'Entertainment', 'Investments']);
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('sends unknown merchants to the LLM in one batch, deduplicated, names only', async () => {
    const a = unknownMerchant('a');
    const b = unknownMerchant('b');
    const classifier = fakeClassifier((name) => (name === merchantKey(a) ? 'Shopping' : 'Dining'));
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    const result = await categoriser.categorise([debit(a), debit(b), debit(a), debit('Swiggy')]);

    expect(result).toEqual(['Shopping', 'Dining', 'Shopping', 'Food delivery']);
    expect(classifier.classify).toHaveBeenCalledTimes(1);
    const sent = classifier.classify.mock.calls[0][0];
    expect(sent).toEqual([merchantKey(a), merchantKey(b)]);
    // Only merchant names are sent: no amounts, refs or full descriptions.
    expect(JSON.stringify(sent)).not.toContain('1234567890');
    expect(JSON.stringify(sent)).not.toContain('UPI/');
  });

  it('maps an LLM answer outside the fixed list to Unidentified', async () => {
    const m = unknownMerchant('bad');
    const classifier = fakeClassifier('Crypto');
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    const result = await categoriser.categorise([debit(m)]);

    expect(result).toEqual(['Unidentified']);
  });

  it('caches LLM answers: a second upload with the same merchants does not call the LLM', async () => {
    const m = unknownMerchant('cached');
    const classifier = fakeClassifier('Health');
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    const first = await categoriser.categorise([debit(m)]);
    const second = await categoriser.categorise([debit(m), debit(m)]);

    expect(first).toEqual(['Health']);
    expect(second).toEqual(['Health', 'Health']);
    expect(classifier.classify).toHaveBeenCalledTimes(1);

    const [rows] = await db.query('SELECT category, source FROM merchant_categories WHERE merchant_key = ?', [
      merchantKey(m),
    ]);
    expect(rows).toEqual([{ category: 'Health', source: 'llm' }]);
  });

  it('does not cache an invalid LLM answer, so the merchant is asked again later', async () => {
    const m = unknownMerchant('retry');
    const classifier = fakeClassifier('Crypto');
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    await categoriser.categorise([debit(m)]);
    await categoriser.categorise([debit(m)]);

    expect(classifier.classify).toHaveBeenCalledTimes(2);
  });

  it('with no LLM configured (missing key): Unidentified, no throw, one warning', async () => {
    const logger = fakeLogger();
    const categoriser = createCategoriser({ db, classifier: null, logger });

    const result = await categoriser.categorise([debit(unknownMerchant('nokey')), debit('Swiggy')]);

    expect(result).toEqual(['Unidentified', 'Food delivery']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/OPENAI_API_KEY/);
  });

  it('when the LLM call fails: Unidentified, no throw, a warning, and nothing cached', async () => {
    const m = unknownMerchant('fail');
    const logger = fakeLogger();
    const classifier = { classify: vi.fn().mockRejectedValue(new Error('429 rate limited')) };
    const categoriser = createCategoriser({ db, classifier, logger });

    const result = await categoriser.categorise([debit(m)]);

    expect(result).toEqual(['Unidentified']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [rows] = await db.query('SELECT 1 FROM merchant_categories WHERE merchant_key = ?', [merchantKey(m)]);
    expect(rows).toHaveLength(0);
  });

  it('a row with no merchant and no rule is Unidentified without asking the LLM', async () => {
    const classifier = fakeClassifier('Shopping');
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    const result = await categoriser.categorise([
      { merchant: null, description: 'UPI/9876543210@ybl/x', direction: 'debit', channel: 'UPI' },
    ]);

    expect(result).toEqual(['Unidentified']);
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('returns [] for no rows without touching the DB or LLM', async () => {
    const classifier = fakeClassifier('Shopping');
    const categoriser = createCategoriser({ db: null, classifier, logger: fakeLogger() });

    expect(await categoriser.categorise([])).toEqual([]);
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});

describe('merchantKey', () => {
  it('uppercases, collapses punctuation and strips long digit runs (refs, phone numbers)', () => {
    expect(merchantKey('  Ramesh  Kirana-Store ')).toBe('RAMESH KIRANA STORE');
    expect(merchantKey('Shop 9876543210')).toBe('SHOP');
    expect(merchantKey('7-Eleven')).toBe('7 ELEVEN');
    expect(merchantKey('1mg')).toBe('1MG');
  });

  it('returns null when nothing usable is left', () => {
    expect(merchantKey(null)).toBeNull();
    expect(merchantKey('  ')).toBeNull();
    expect(merchantKey('123456789')).toBeNull();
  });
});

describe('person-to-person payments (P2P)', () => {
  const p2p = (merchant, description, direction = 'debit') => ({
    merchant,
    description,
    direction,
    channel: 'UPI',
    isPerson: true,
  });

  it('are Transfers (others) by rule: never sent to the LLM, never cached', async () => {
    const name = `Rahul Sharma ${randomUUID().slice(0, 4).replace(/\d/g, 'q')}`;
    const classifier = fakeClassifier('Dining');
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    const result = await categoriser.categorise([
      p2p(name, `UPI-${name.toUpperCase()}-9876543210@ybl-SBIN0001234-512398765432-dinner`),
      p2p(name, `UPI-${name.toUpperCase()}-9876543210@ybl-SBIN0001234-512398765499-gift`, 'credit'),
    ]);

    expect(result).toEqual(['Transfers (others)', 'Transfers (others)']);
    expect(classifier.classify).not.toHaveBeenCalled();
    const [rows] = await db.query('SELECT 1 FROM merchant_categories WHERE merchant_key = ?', [merchantKey(name)]);
    expect(rows).toHaveLength(0);
  });

  it('still let a keyword rule win first (rent paid to a landlord, a self transfer)', async () => {
    const classifier = fakeClassifier('Dining');
    const categoriser = createCategoriser({ db, classifier, logger: fakeLogger() });

    const result = await categoriser.categorise([
      p2p('Suresh Kumar', 'IMPS-512345678901-SURESH KUMAR-SBIN-XXXXXX4521-RENT NOV'),
      p2p('Asha Rao', 'UPI-ASHA RAO-asha@okaxis-UTIB0000123-512398765433-SELF TRANSFER'),
    ]);

    expect(result).toEqual(['Rent', 'Self-transfer']);
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('a person name cached earlier by mistake is still not used', async () => {
    const name = `Priya Nair ${randomUUID().slice(0, 4).replace(/\d/g, 'q')}`;
    await db.query("INSERT INTO merchant_categories (merchant_key, category, source) VALUES (?, 'Dining', 'llm')", [
      merchantKey(name),
    ]);
    const categoriser = createCategoriser({ db, classifier: null, logger: fakeLogger() });

    expect(await categoriser.categorise([p2p(name, `UPI-${name}-x@okaxis-512398765433-UPI`)])).toEqual([
      'Transfers (others)',
    ]);
  });
});
