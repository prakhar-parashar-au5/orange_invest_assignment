import { describe, it, expect } from 'vitest';
import { parseMoney } from '../src/ingest/money.js';
import { parseDate } from '../src/ingest/dates.js';
import { parseNarration } from '../src/ingest/narration.js';
import { detectFormat } from '../src/ingest/formats.js';

describe('parseMoney → integer paise, no float maths', () => {
  it.each([
    ['1,23,456.78', 12345678, 1],
    ['123,456.78', 12345678, 1],
    ['1234', 123400, 1],
    ['1234.5', 123450, 1],
    ['0.29', 29, 1],
    ['1.15', 115, 1],
    ['4.35', 435, 1],
    ['₹ 500.00', 50000, 1],
    ['INR 500', 50000, 1],
    ['Rs. 500', 50000, 1],
    ['-250.00', 25000, -1],
    ['250.00 Dr', 25000, -1],
    ['250.00 DR.', 25000, -1],
    ['250.00Cr', 25000, 1],
    ['(250.00)', 25000, -1],
    ['+250', 25000, 1],
    ['  9,99,99,999.99 ', 9999999999, 1],
  ])('%s → %i paise, sign %i', (input, paise, sign) => {
    expect(parseMoney(input)).toEqual({ paise, sign });
  });

  it.each([[''], ['   '], [null], [undefined]])('%o → null (empty cell)', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it.each([['abc'], ['1.234'], ['12,34'], ['1..2'], ['--5'], ['5 Dr Cr'], [',123']])('%s throws', (input) => {
    expect(() => parseMoney(input)).toThrow(/amount/i);
  });
});

describe('parseDate → IST calendar date YYYY-MM-DD', () => {
  it.each([
    ['14/10/26', '2026-10-14'],
    ['14/10/2026', '2026-10-14'],
    ['4/1/2026', '2026-01-04'],
    ['14-10-2026', '2026-10-14'],
    ['14.10.2026', '2026-10-14'],
    ['14-Oct-2026', '2026-10-14'],
    ['14 Oct 2026', '2026-10-14'],
    ['14-OCT-26', '2026-10-14'],
    ['2026-10-14', '2026-10-14'],
    ['29/02/2028', '2028-02-29'],
    ['14/10/2026 10:22:01', '2026-10-14'],
  ])('%s → %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it.each([['31/02/2026'], ['13/31/2026'], ['29/02/2026'], ['2026/13/01'], ['yesterday'], [''], ['14-Foo-2026']])(
    '%s throws',
    (input) => {
      expect(() => parseDate(input)).toThrow(/date/i);
    },
  );
});

describe('parseNarration', () => {
  it.each([
    [
      'UPI-SWIGGY-swiggy@icici-ICIC0000001-429183746512-Payment from Phone',
      null,
      { channel: 'UPI', ref: '429183746512', merchant: 'Swiggy', isPerson: false },
    ],
    [
      'UPI/429183746512/ZOMATO LTD/zomato@hdfcbank/food',
      null,
      { channel: 'UPI', ref: '429183746512', merchant: 'Zomato', isPerson: false },
    ],
    [
      'UPI-RAHUL SHARMA-9876543210@ybl-SBIN0001234-512398765432-dinner split',
      '0000512398765432',
      { channel: 'UPI', ref: '0000512398765432', merchant: 'Rahul Sharma', isPerson: true },
    ],
    [
      'UPI-PRIYA NAIR-priya.nair@okaxis-UTIB0000123-512398765433-UPI',
      null,
      { channel: 'UPI', ref: '512398765433', merchant: 'Priya Nair', isPerson: true },
    ],
    [
      'UPI-MAHALAXMI GENERAL STORE-mahalaxmi.store@ybl-HDFC0000001-512398765434-UPI',
      null,
      { channel: 'UPI', ref: '512398765434', merchant: 'Mahalaxmi General Store', isPerson: false },
    ],
    [
      'NEFT CR-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY NOV 26-CITIN26112400123',
      null,
      { channel: 'NEFT', ref: null, merchant: 'Acme', isPerson: false },
    ],
    [
      'IMPS-512345678901-SURESH KUMAR-SBIN-XXXXXX4521-RENT NOV',
      null,
      { channel: 'IMPS', ref: '512345678901', merchant: 'Suresh Kumar', isPerson: true },
    ],
    [
      'ATW-512345XXXXXX1234-MG ROAD BANGALORE',
      null,
      { channel: 'ATM', ref: null, merchant: null, isPerson: false },
    ],
    [
      'POS 512345XXXXXX1234 HPCL PETROL PUMP',
      null,
      { channel: 'CARD', ref: null, merchant: 'Hpcl Petrol Pump', isPerson: false },
    ],
    [
      'ACH D- BAJAJ FINANCE LTD-BFL7788990011',
      'BFL7788990011',
      { channel: 'OTHER', ref: 'BFL7788990011', merchant: 'Bajaj Finance', isPerson: false },
    ],
    ['CHQ PAID-000123-RAJ MOTORS', '000123', { channel: 'CHEQUE', ref: '000123', merchant: 'Raj Motors', isPerson: false }],
  ])('%s', (description, refColumn, expected) => {
    expect(parseNarration(description, refColumn)).toEqual(expected);
  });

  it('ignores an all-zero ref column', () => {
    expect(parseNarration('POS 512345XXXXXX1234 AMAZON', '000000000000').ref).toBeNull();
  });
});

describe('detectFormat', () => {
  it('detects the HDFC-like layout, ignoring case, spaces and punctuation in headers', () => {
    const format = detectFormat([' date ', 'NARRATION', 'Chq/Ref No', 'Value Dt', 'Withdrawal Amt', 'Deposit Amt.', 'Closing Balance']);

    expect(format.id).toBe('hdfc-like');
    expect(format.index).toEqual({ date: 0, description: 1, ref: 2, debit: 4, credit: 5, balance: 6 });
  });

  it('detects a single signed-amount layout with an optional Dr/Cr column', () => {
    const format = detectFormat(['Txn Date', 'Description', 'Amount', 'Dr/Cr', 'Balance']);

    expect(format.id).toBe('signed-amount');
    expect(format.index).toEqual({ date: 0, description: 1, amount: 2, drcr: 3, balance: 4 });
  });

  it('returns null for unknown headers', () => {
    expect(detectFormat(['when', 'what', 'how much'])).toBeNull();
    expect(detectFormat(['Date', 'Narration'])).toBeNull();
  });
});
