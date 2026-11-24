import { describe, it, expect } from 'vitest';
import moment from 'moment-timezone';
import { resolvePeriod, todayIst, completeMonths } from '../src/agent/periods.js';

const at = (iso) => moment.tz(iso, 'Asia/Kolkata');
const NOW = at('2026-11-24T12:00:00');

describe('resolvePeriod (IST)', () => {
  it.each([
    ['this_month', '2026-11-01', '2026-11-24'],
    ['last_month', '2026-10-01', '2026-10-31'],
    ['this_year', '2026-01-01', '2026-11-24'],
    ['last_year', '2025-01-01', '2025-12-31'],
    ['last_30_days', '2026-10-26', '2026-11-24'],
    ['last_7_days', '2026-11-18', '2026-11-24'],
    ['month:2026-02', '2026-02-01', '2026-02-28'],
    ['month:2028-02', '2028-02-01', '2028-02-29'],
    ['year:2025', '2025-01-01', '2025-12-31'],
    ['range:2026-10-05..2026-10-09', '2026-10-05', '2026-10-09'],
    ['all_time', '1900-01-01', '2026-11-24'],
    ['months_ago:0', '2026-11-01', '2026-11-24'],
    ['today', '2026-11-24', '2026-11-24'],
    ['yesterday', '2026-11-23', '2026-11-23'],
    ['this_week', '2026-11-23', '2026-11-24'],
    ['months_ago:2', '2026-09-01', '2026-09-30'],
    ['last_3_months', '2026-08-01', '2026-10-31'],
    ['last_12_months', '2025-11-01', '2026-10-31'],
  ])('%s → %s..%s', (period, from, to) => {
    expect(resolvePeriod(period, NOW)).toMatchObject({ from, to });
  });

  describe('a month name without a year means the most recent one that has started', () => {
    it.each([
      ['month_name:october', NOW, '2026-10-01', '2026-10-31'],
      ['month_name:November', NOW, '2026-11-01', '2026-11-24'],
      ['month_name:december', NOW, '2025-12-01', '2025-12-31'],
      ['month_name:jan', NOW, '2026-01-01', '2026-01-31'],
      ['month_name:october', at('2026-10-01T00:05:00'), '2026-10-01', '2026-10-01'],
      ['month_name:october', at('2026-09-30T23:55:00'), '2025-10-01', '2025-10-31'],
    ])('%s at %s → %s..%s', (period, now, from, to) => {
      expect(resolvePeriod(period, now)).toMatchObject({ from, to });
    });
  });

  describe('month boundaries use IST, not UTC', () => {
    it('00:30 IST on 1 Dec is already December (it is still 30 Nov in UTC)', () => {
      const now = moment.tz('2026-11-30T19:00:00Z', 'Asia/Kolkata'); // 00:30 IST, 1 Dec
      expect(resolvePeriod('this_month', now)).toMatchObject({ from: '2026-12-01', to: '2026-12-01' });
      expect(resolvePeriod('last_month', now)).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    });

    it('last_month in January is December of the previous year', () => {
      expect(resolvePeriod('last_month', at('2027-01-15T10:00:00'))).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    });

    it('last_month on 31 March is February (no month overflow)', () => {
      expect(resolvePeriod('last_month', at('2026-03-31T10:00:00'))).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    });
  });

  describe('today, yesterday, this_week (weeks start on Monday, IST)', () => {
    it.each([
      // 2026-11-23 is a Monday, 2026-11-29 a Sunday
      ['Monday', '2026-11-23T09:00:00', '2026-11-23'],
      ['Sunday', '2026-11-29T21:00:00', '2026-11-23'],
      ['the next Monday', '2026-11-30T00:10:00', '2026-11-30'],
    ])('this_week on a %s starts %s', (_label, iso, from) => {
      const now = at(iso);
      expect(resolvePeriod('this_week', now)).toMatchObject({ from, to: now.format('YYYY-MM-DD') });
    });

    it('yesterday on 1 Jan is 31 Dec', () => {
      expect(resolvePeriod('yesterday', at('2027-01-01T08:00:00'))).toMatchObject({ from: '2026-12-31', to: '2026-12-31' });
    });

    it('today follows the IST date, not UTC', () => {
      const now = moment.tz('2026-11-24T19:00:00Z', 'Asia/Kolkata'); // 00:30 IST on the 25th
      expect(resolvePeriod('today', now)).toMatchObject({ from: '2026-11-25', to: '2026-11-25' });
    });
  });

  it('adds a human label', () => {
    expect(resolvePeriod('month:2026-10', NOW).label).toBe('October 2026');
    expect(resolvePeriod('last_30_days', NOW).label).toBe('26 Oct 2026 – 24 Nov 2026');
  });

  it.each([
    ['next_month'],
    ['month:2026-13'],
    ['month_name:smarch'],
    ['range:2026-10-09..2026-10-05'],
    ['range:2026-02-30..2026-03-01'],
    ['last_0_days'],
    ['last_5000_days'],
    [''],
    [undefined],
    [42],
  ])('rejects %o with a message the model can act on', (period) => {
    expect(() => resolvePeriod(period, NOW)).toThrow(/period/i);
  });
});

describe('todayIst', () => {
  it('is the IST calendar date', () => {
    expect(todayIst(moment('2026-11-24T19:00:00Z'))).toBe('2026-11-25');
  });
});

describe('completeMonths', () => {
  it('lists the calendar months inside a period that have fully ended', () => {
    expect(completeMonths({ from: '2026-08-15', to: '2026-11-24' }, NOW)).toEqual(['2026-09', '2026-10']);
    expect(completeMonths({ from: '2026-01-01', to: '2026-12-31' }, NOW)).toHaveLength(10);
  });
});
