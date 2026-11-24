// The ONE place that knows bank CSV column names. When Prakhar's demo CSV arrives, add or adjust
// aliases here; nothing else in ingestion knows column names.
//
// Headers are compared after lowercasing and stripping everything that isn't a letter or digit,
// so "Chq./Ref.No." and "chq ref no" are the same header.

const ALIASES = {
  date: ['date', 'txndate', 'transactiondate', 'trandate', 'postingdate', 'txnpostingdate'],
  description: ['narration', 'description', 'particulars', 'remarks', 'transactiondetails', 'details', 'transactionremarks'],
  ref: ['chqrefno', 'refno', 'chequeno', 'chqno', 'reference', 'refchqno', 'utr', 'referenceno', 'chequerefno'],
  debit: ['withdrawalamt', 'withdrawal', 'withdrawals', 'debit', 'debitamount', 'withdrawalamount', 'withdrawalamtinr', 'debitamt'],
  credit: ['depositamt', 'deposit', 'deposits', 'credit', 'creditamount', 'depositamount', 'depositamtinr', 'creditamt'],
  balance: ['closingbalance', 'balance', 'runningbalance', 'availablebalance', 'balanceinr'],
  amount: ['amount', 'txnamount', 'transactionamount', 'amountinr'],
  drcr: ['drcr', 'crdr', 'debitcredit', 'type', 'txntype'],
};

/** Formats in priority order. The first one whose required columns are all present wins. */
export const FORMATS = [
  { id: 'hdfc-like', required: ['date', 'description', 'debit', 'credit'], optional: ['ref', 'balance'] },
  { id: 'signed-amount', required: ['date', 'description', 'amount'], optional: ['ref', 'drcr', 'balance'] },
];

const normaliseHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param {string[]} headerCells
 * @returns {{ id: string, index: Record<string, number> } | null}
 */
export function detectFormat(headerCells) {
  const normalised = headerCells.map(normaliseHeader);
  const find = (field) => normalised.findIndex((h) => ALIASES[field].includes(h));

  for (const format of FORMATS) {
    const index = {};
    let ok = true;
    for (const field of format.required) {
      const i = find(field);
      if (i === -1) {
        ok = false;
        break;
      }
      index[field] = i;
    }
    if (!ok) continue;
    for (const field of format.optional) {
      const i = find(field);
      if (i !== -1) index[field] = i;
    }
    return { id: format.id, index };
  }
  return null;
}
