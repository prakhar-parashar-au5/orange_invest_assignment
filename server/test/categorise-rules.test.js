import { describe, it, expect } from 'vitest';
import { ruleCategory } from '../src/categorise/rules.js';
import { isCategory } from '../src/categories.js';

const debit = (merchant, description = merchant, channel = 'UPI') => ({ merchant, description, direction: 'debit', channel });
const credit = (merchant, description = merchant, channel = 'NEFT') => ({ merchant, description, direction: 'credit', channel });

describe('ruleCategory', () => {
  it.each([
    // merchant keyword map
    [debit('Swiggy', 'UPI/SWIGGY/429183746512/Payment'), 'Food delivery'],
    [debit('Zomato', 'UPI/ZOMATO LTD/512398/food'), 'Food delivery'],
    [debit('Swiggy Instamart', 'UPI/SWIGGY INSTAMART/1234/x'), 'Groceries'],
    [debit('BigBasket'), 'Groceries'],
    [debit('Blinkit'), 'Groceries'],
    [debit('Zepto'), 'Groceries'],
    [debit('JioMart'), 'Groceries'],
    [debit('Starbucks'), 'Dining'],
    [debit('Amazon', 'UPI/AMAZON PAY/88/order'), 'Shopping'],
    [debit('Amazon Prime', 'AMAZON PRIME MEMBERSHIP'), 'Entertainment'],
    [debit('Flipkart'), 'Shopping'],
    [debit('IRCTC', 'IRCTC E TICKET'), 'Travel'],
    [debit('Uber'), 'Travel'],
    [debit('HPCL', 'HPCL PETROL PUMP'), 'Fuel'],
    [debit('Indian Oil'), 'Fuel'],
    [debit('Airtel', 'AIRTEL POSTPAID'), 'Bills & utilities'],
    [debit('Jio', 'JIO PREPAID RECHARGE'), 'Bills & utilities'],
    [debit('BESCOM'), 'Bills & utilities'],
    [debit('NoBroker', 'NOBROKER RENT PAYMENT'), 'Rent'],
    [debit(null, 'NEFT/RENT NOV/LANDLORD'), 'Rent'],
    [debit('Bajaj Finance', 'NACH/BAJAJ FINANCE EMI'), 'EMI/loans'],
    [debit(null, 'HDFC BANK LOAN EMI 22'), 'EMI/loans'],
    [debit('Zerodha'), 'Investments'],
    [debit('Groww', 'GROWW SIP'), 'Investments'],
    [debit(null, 'NACH/ICICI PRU MF SIP'), 'Investments'],
    [debit('LIC', 'LIC PREMIUM'), 'Insurance'],
    [debit('Apollo Pharmacy'), 'Health'],
    [debit('1mg'), 'Health'],
    [debit('Netflix', 'NETFLIX.COM'), 'Entertainment'],
    [debit('Spotify'), 'Entertainment'],
    [debit('BookMyShow'), 'Entertainment'],
    // direction- and channel-aware
    [credit('Acme Corp', 'NEFT/ACME CORP PVT LTD/SALARY NOV'), 'Salary'],
    [credit(null, 'SAL CREDIT ACME'), 'Salary'],
    [credit('Swiggy', 'UPI/SWIGGY/REFUND/1234'), 'Refunds'],
    [credit(null, 'REVERSAL OF CHARGES'), 'Refunds'],
    [debit(null, 'ATM WDL/MG ROAD BLR', 'ATM'), 'Cash withdrawal'],
    [debit(null, 'NWD-ATM CASH 0123', 'OTHER'), 'Cash withdrawal'],
    [debit(null, 'IMPS/SELF TRANSFER/TO OWN A/C', 'IMPS'), 'Self-transfer'],
    [credit(null, 'IMPS/SELF/FROM OWN ACCOUNT', 'IMPS'), 'Self-transfer'],
  ])('%o → %s', (txn, expected) => {
    expect(ruleCategory(txn)).toBe(expected);
  });

  it.each([
    [debit('Ramesh Kirana Store', 'UPI/RAMESH KIRANA STORE/9988/x')],
    [debit('Zqx Traders')],
    [debit(null, 'UPI/9876543210@ybl/payment')],
    [credit(null, 'NEFT/SOMEONE/gift')],
  ])('returns null for %o so the fallback decides', (txn) => {
    expect(ruleCategory(txn)).toBeNull();
  });

  it('does not let a salary keyword on a debit become Salary', () => {
    expect(ruleCategory(debit(null, 'SALARY ADVANCE REPAYMENT'))).not.toBe('Salary');
  });

  it('does not match keywords inside other words', () => {
    // RENT inside CURRENT, SIP inside GOSSIP, LIC inside PUBLIC
    expect(ruleCategory(debit(null, 'CURRENT ACCOUNT CHARGES GOSSIP PUBLIC'))).toBeNull();
  });

  it('only ever returns a valid category or null', () => {
    const samples = ['SWIGGY', 'ATM', 'SALARY', 'X', '', 'NETFLIX'];
    for (const d of samples) {
      for (const direction of ['debit', 'credit']) {
        const result = ruleCategory({ merchant: null, description: d, direction, channel: 'OTHER' });
        expect(result === null || isCategory(result)).toBe(true);
      }
    }
  });
});
