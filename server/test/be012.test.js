// BE-012: Q6 wording rule (prompt v2), merchant extraction fixes from TE-003, new rules, cache hygiene.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseNarration } from '../src/ingest/narration.js';
import { ruleCategory } from '../src/categorise/rules.js';
import { createCategoriser, merchantKey } from '../src/categorise/index.js';
import { TOOL_DEFINITIONS } from '../src/agent/tools.js';
import { systemPrompt } from '../src/agent/agent.js';
import { PROMPT_VERSION } from '../src/agent/recorder.js';
import { testConfig } from './helpers.js';
import { createPool } from '../src/db.js';

describe('Q6: "transactions" means every direction and category (prompt v2)', () => {
  it('the list_transactions description and the system prompt both carry the rule', () => {
    const list = TOOL_DEFINITIONS.find((t) => t.name === 'list_transactions');
    const prompt = systemPrompt();

    for (const text of [list.description, list.parameters.properties.spend_only.description, prompt]) {
      expect(text).toMatch(/only when the user asks about spend/i);
    }
    expect(prompt).toMatch(/"transactions".*every direction and category/i);
    expect(PROMPT_VERSION).toBe('v2');
  });
});

describe('merchant extraction (TE-003)', () => {
  it.each([
    ['IMPS/P2A/957698/Priya Sharma', { channel: 'IMPS', merchant: 'Priya Sharma', isPerson: true }],
    ['UPI/DR/FRESHMART INDIRANAGAR VPA freshmart@okicici UTR 600412309876', { channel: 'UPI', merchant: 'Freshmart', isPerson: false }],
    ['IMPS/DR/CITYCAB MOBILITY/600412309877', { merchant: 'Citycab Mobility' }],
    ['NEFT/CR/KKBK0000123/RAZORPAY/JKJLD0', { channel: 'NEFT', merchant: 'Razorpay' }],
    ['PHONEPE SWIGGYBLR', { channel: 'UPI', merchant: 'Swiggy', isPerson: false }],
    ['GPAY*DOMINOSBLR', { channel: 'UPI', merchant: 'Dominos' }],
    ['PHONEPE*DMART', { channel: 'UPI', merchant: 'Dmart' }],
    ['POS 9104 BLINKIT', { channel: 'CARD', merchant: 'Blinkit' }],
    ['UPI-Rahul@ybl', { channel: 'UPI', merchant: 'Rahul', isPerson: true }],
    ['UPI/rahul@paytm', { channel: 'UPI', merchant: 'Rahul', isPerson: true }],
    ['UPI PAY Rahul', { channel: 'UPI', merchant: 'Rahul', isPerson: true }],
    ['NEFT-VENDOR PAYMENT', { isPerson: false }],
    ['NEFT-ICIC0000001-RAZORPAY SOFTWAR', { isPerson: false }],
    // unchanged: a business name the VPA doesn't shorten, a known brand on UPI isn't a person
    ['UPI-SHREE GANESH TRADERS-shreeganesh@ybl-HDFC0000001-512398765434-UPI', { merchant: 'Shree Ganesh Traders', isPerson: false }],
    ['UPI-SWIGGY-swiggy@icici-ICIC0000001-429183746512-Payment from Phone', { merchant: 'Swiggy', isPerson: false }],
  ])('%s', (narration, expected) => {
    expect(parseNarration(narration)).toMatchObject(expected);
  });
});

describe('new rules', () => {
  const t = (description, direction, channel = 'OTHER') => ({ merchant: null, description, direction, channel });
  it.each([
    [t('NEFT/CR/KKBK0000123/RAZORPAY/JKJLD0', 'credit', 'NEFT'), 'Transfers (others)'],
    [t('NEFT CLIENT SETTLEMENT JUL', 'credit', 'NEFT'), 'Transfers (others)'],
    [t('RAZORPAY REFUND ORDER 99', 'credit', 'NEFT'), 'Refunds'],
    [t('ECS RETURN BOUNCE DISHONOURED', 'debit'), 'Bills & utilities'],
    [t('GPAY DOMINOS', 'debit', 'UPI'), 'Food delivery'],
    [t('POS DOMINOS', 'debit', 'CARD'), 'Dining'],
  ])('%o → %s', (txn, category) => {
    expect(ruleCategory(txn)).toBe(category);
  });
});

describe('cache hygiene and privacy', () => {
  let db;
  beforeAll(() => {
    db = createPool(testConfig().databaseUrl);
  });
  afterAll(() => db.end());

  it('a single first name over UPI is P2P and never reaches the LLM or the cache', async () => {
    const classify = vi.fn(async (names) => names.map(() => 'Dining'));
    const categoriser = createCategoriser({ db, classifier: { classify }, logger: { warn() {} } });
    const n = parseNarration('UPI/rahul@paytm');

    const [category] = await categoriser.categorise([{ merchant: n.merchant, description: 'UPI/rahul@paytm', direction: 'debit', channel: n.channel, isPerson: n.isPerson }]);

    expect(category).toBe('Transfers (others)');
    expect(classify).not.toHaveBeenCalled();
    const [rows] = await db.query("SELECT 1 FROM merchant_categories WHERE merchant_key = 'RAHUL'");
    expect(rows).toHaveLength(0);
  });

  it('an Unidentified LLM answer is not cached, so the next upload asks again', async () => {
    const name = `Qzv Unknown Traders ${randomUUID().slice(0, 4).replace(/\d/g, 'k')}`;
    const classify = vi.fn(async (names) => names.map(() => 'Unidentified'));
    const categoriser = createCategoriser({ db, classifier: { classify }, logger: { warn() {} } });
    const row = { merchant: name, description: name, direction: 'debit', channel: 'UPI' };

    await categoriser.categorise([row]);
    await categoriser.categorise([row]);

    expect(classify).toHaveBeenCalledTimes(2);
    const [rows] = await db.query('SELECT 1 FROM merchant_categories WHERE merchant_key = ?', [merchantKey(name)]);
    expect(rows).toHaveLength(0);
  });

  it.each([['DR'], ['CR'], ['P2A'], ['IFT'], ['Mb'], ['Xy'], ['Settlement'], ['Client']])('stop-listed key %s is never sent or cached', async (merchant) => {
    const classify = vi.fn(async (names) => names.map(() => 'Shopping'));
    const categoriser = createCategoriser({ db, classifier: { classify }, logger: { warn() {} } });

    const [category] = await categoriser.categorise([{ merchant, description: 'x', direction: 'debit', channel: 'OTHER' }]);

    expect(category).toBe('Unidentified');
    expect(classify).not.toHaveBeenCalled();
  });
});
