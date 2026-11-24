import { describe, it, expect } from 'vitest';
import { canonicalMerchant } from '../src/ingest/merchant-names.js';
import { parseNarration } from '../src/ingest/narration.js';
import { merchantKey } from '../src/categorise/index.js';

describe('Unicode merchants (TE-001 bug 1)', () => {
  it('keeps Hindi and accented letters', () => {
    const r = parseNarration('UPI-शर्मा किराना Café-sharmacafe@ybl-HDFC0000001-512398765434-UPI');

    expect(r.merchant).toBe('शर्मा किराना Café');
    expect(r.isPerson).toBe(false); // CAFÉ is a business word once the accent is ignored
    expect(merchantKey(r.merchant)).toBe('शर्मा किराना CAFÉ');
  });

  it('still recognises an accented person name as a person', () => {
    expect(parseNarration('UPI-JOSÉ PEREIRA-jose@okaxis-UTIB0000123-512398765433-UPI')).toMatchObject({
      merchant: 'José Pereira',
      isPerson: true,
    });
  });
});

describe('canonicalMerchant (TE-001 bug 2)', () => {
  it.each([
    ['ZOMATO LTD', 'Zomato'],
    ['Zomato', 'Zomato'],
    ['AMAZON PAY', 'Amazon'],
    ['Amazon Pay India Pvt Ltd', 'Amazon'],
    ['AMAZON', 'Amazon'],
    ['SPOTIFY INDIA', 'Spotify'],
    ['UBER INDIA', 'Uber'],
    ['BAJAJ FINANCE LTD', 'Bajaj Finance'],
    ['ACME TECHNOLOGIES PVT LTD', 'Acme'],
    ['Paytm Payments', 'Paytm'],
    ['SWIGGY INSTAMART', 'Swiggy Instamart'], // a different merchant and category, kept apart
    ['INDIAN OIL FUEL STN', 'Indian Oil Fuel Stn'], // INDIAN isn't INDIA
    ['PAY', 'Pay'], // never strip down to nothing
    ['INDIA LTD', 'India'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalMerchant(input)).toBe(expected);
  });

  it('is applied at ingest, so variants of one shop share a name', () => {
    const a = parseNarration('UPI-ZOMATO LTD-zomato@hdfcbank-HDFC0000001-512398765402-food');
    const b = parseNarration('UPI-ZOMATO-zomato@hdfcbank-HDFC0000001-512398765403-food');
    const c = parseNarration('POS 512345XXXXXX1234 AMAZON PAY INDIA');

    expect([a.merchant, b.merchant, c.merchant]).toEqual(['Zomato', 'Zomato', 'Amazon']);
  });

  it('does not touch person names', () => {
    expect(parseNarration('IMPS-512345678901-SURESH KUMAR-SBIN-XXXXXX4521-RENT NOV').merchant).toBe('Suresh Kumar');
  });
});
