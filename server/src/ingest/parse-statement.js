// CSV bytes → normalised rows plus rejected rows. Pure: no DB, no LLM.
import { parse } from 'csv-parse/sync';
import { HttpError } from '../http/errors.js';
import { detectFormat } from './formats.js';
import { parseMoney } from './money.js';
import { parseDate } from './dates.js';
import { parseNarration } from './narration.js';

export const MAX_DATA_ROWS = 20000;
const HEADER_SEARCH_LINES = 30; // statements often start with a preamble (bank name, account, period)

const unprocessable = (code, message) => new HttpError(422, code, message);

function readCsv(buffer) {
  const text = buffer.toString('utf8');
  // A NUL byte means this is a binary file, not a CSV.
  if (text.includes('\u0000')) throw unprocessable('UNKNOWN_FORMAT', 'The file is not a readable CSV');
  try {
    return parse(text, {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
      info: true,
    });
  } catch {
    throw unprocessable('UNKNOWN_FORMAT', 'The file is not a readable CSV');
  }
}

function findHeader(records) {
  const limit = Math.min(records.length, HEADER_SEARCH_LINES);
  for (let i = 0; i < limit; i += 1) {
    const format = detectFormat(records[i].record);
    if (format) return { headerAt: i, format };
  }
  return null;
}

const cell = (cells, index, field) => (index[field] === undefined ? '' : (cells[index[field]] ?? ''));

/** One CSV row → a normalised transaction (without category). Throws with a human reason. */
function normaliseRow(cells, header, { id, index }) {
  const txn_date = parseDate(cell(cells, index, 'date'));
  const description_raw = cell(cells, index, 'description').replace(/\s+/g, ' ').trim();
  if (!description_raw) throw new Error('Missing description');

  let amount_paise;
  let direction;
  if (id === 'hdfc-like') {
    const debit = parseMoney(cell(cells, index, 'debit'));
    const credit = parseMoney(cell(cells, index, 'credit'));
    const hasDebit = debit !== null && debit.paise > 0;
    const hasCredit = credit !== null && credit.paise > 0;
    if (hasDebit === hasCredit) {
      throw new Error(hasDebit ? 'Both withdrawal and deposit amounts are set' : 'Missing amount');
    }
    [amount_paise, direction] = hasDebit ? [debit.paise, 'debit'] : [credit.paise, 'credit'];
  } else {
    const amount = parseMoney(cell(cells, index, 'amount'));
    if (amount === null || amount.paise === 0) throw new Error('Missing amount');
    const drcr = cell(cells, index, 'drcr').toUpperCase().replace(/[^A-Z]/g, '');
    if (['DR', 'D', 'DEBIT'].includes(drcr)) direction = 'debit';
    else if (['CR', 'C', 'CREDIT'].includes(drcr)) direction = 'credit';
    else if (drcr === '') direction = amount.sign < 0 ? 'debit' : 'credit';
    else throw new Error(`Unknown Dr/Cr value '${cell(cells, index, 'drcr')}'`);
    amount_paise = amount.paise;
  }

  const balance = parseMoney(cell(cells, index, 'balance'));
  const narration = parseNarration(description_raw, cell(cells, index, 'ref') || null);

  return {
    source: id,
    txn_date,
    description_raw: description_raw.slice(0, 500),
    merchant: narration.merchant,
    isPerson: narration.isPerson,
    amount_paise,
    direction,
    balance_paise: balance ? balance.paise * balance.sign : null,
    channel: narration.channel,
    ref: narration.ref,
    raw: Object.fromEntries(header.map((h, i) => [h || `column_${i + 1}`, cells[i] ?? ''])),
  };
}

/**
 * @param {Buffer} buffer
 * @returns {{ format: string, rows: (object & { line: number })[], rejected: { line: number, reason: string }[], total: number }}
 */
export function parseStatement(buffer) {
  const records = readCsv(buffer);
  const found = findHeader(records);
  if (!found) {
    throw unprocessable('UNKNOWN_FORMAT', 'The header row does not match a known bank statement format');
  }
  const header = records[found.headerAt].record;
  const data = records.slice(found.headerAt + 1);
  if (data.length === 0) throw unprocessable('EMPTY_FILE', 'The file has a header row but no transactions');
  if (data.length > MAX_DATA_ROWS) {
    throw unprocessable('TOO_MANY_ROWS', `The file has more than ${MAX_DATA_ROWS.toLocaleString('en-IN')} rows`);
  }

  const rows = [];
  const rejected = [];
  for (const { record, info } of data) {
    const line = info.lines;
    try {
      rows.push({ ...normaliseRow(record, header, found.format), line });
    } catch (err) {
      rejected.push({ line, reason: err.message });
    }
  }
  return { format: found.format.id, rows, rejected, total: data.length };
}
