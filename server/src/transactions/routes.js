// Upload and transaction read endpoints (API-CONTRACT.md v1). Every query is scoped by req.userId.
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { HttpError, badRequest, notFound } from '../http/errors.js';
import { requireUser } from '../auth/session.js';
import { ingestStatement } from '../ingest/ingest.js';
import { isCategory } from '../categories.js';
import { isValidYmd } from '../ingest/dates.js';
import { toIstIso } from '../util/time.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const CSV_MIME_TYPES = new Set(['text/csv', 'application/vnd.ms-excel', 'application/octet-stream', 'text/plain']);

const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).single('file');

/** multer as a promise, with its errors mapped to contract codes. */
function receiveFile(req, res) {
  return new Promise((resolve, reject) => {
    multipart(req, res, (err) => {
      if (!err) return resolve(req.file);
      if (err.code === 'LIMIT_FILE_SIZE') return reject(new HttpError(413, 'FILE_TOO_LARGE', 'The file is larger than 5 MB'));
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return reject(new HttpError(400, 'NO_FILE', 'Send exactly one file in the "file" field'));
      }
      return reject(badRequest('The upload is not valid multipart/form-data'));
    });
  });
}

const toUploadJson = (u) => ({
  id: u.id,
  filename: u.filename,
  rows_total: u.rows_total,
  rows_inserted: u.rows_inserted,
  rows_duplicate: u.rows_duplicate,
  rows_rejected: u.rows_rejected,
  created_at: toIstIso(u.created_at),
});

const TXN_COLUMNS = 'id, upload_id, txn_date, description_raw, merchant, category, amount_paise, direction, balance_paise, channel, ref';
const toTransactionJson = (t) => ({
  id: t.id,
  upload_id: t.upload_id,
  txn_date: t.txn_date,
  description: t.description_raw,
  merchant: t.merchant,
  category: t.category,
  amount_paise: t.amount_paise,
  direction: t.direction,
  balance_paise: t.balance_paise,
  channel: t.channel,
  ref: t.ref,
});

function positiveInt(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw badRequest(`${name} must be a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw badRequest(`${name} must be between ${min} and ${max}`);
  return n;
}

function pagination(query) {
  const page = positiveInt(query.page, 'page', { fallback: 1, max: 1_000_000 });
  const pageSize = positiveInt(query.page_size, 'page_size', { fallback: 50, max: 200 });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function isoDate(value, name) {
  if (value === undefined) return undefined;
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]))) throw badRequest(`${name} must be a date as YYYY-MM-DD`);
  return value;
}

/** Path id → positive integer, or 404 (a bad id and someone else's id look the same). */
function pathId(value) {
  if (!/^\d{1,15}$/.test(value) || Number(value) <= 0) throw notFound();
  return Number(value);
}

async function pagedTransactions(db, where, params, { page, pageSize, offset }) {
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM transactions WHERE ${where}`, params);
  const [rows] = await db.query(
    `SELECT ${TXN_COLUMNS} FROM transactions WHERE ${where} ORDER BY txn_date DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  return { transactions: rows.map(toTransactionJson), page, page_size: pageSize, total };
}

const pass = (_req, _res, next) => next();

export function transactionsRouter({ config, db, categoriser, uploadLimit = pass }) {
  const router = Router();
  const auth = requireUser(config);

  router.post('/uploads', auth, uploadLimit, async (req, res) => {
    const file = await receiveFile(req, res);
    if (!file) throw new HttpError(400, 'NO_FILE', 'Send the statement in the "file" field');

    const filename = path.basename(file.originalname || 'statement.csv').slice(0, 255);
    if (path.extname(filename).toLowerCase() !== '.csv' || !CSV_MIME_TYPES.has(file.mimetype)) {
      throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'Only CSV bank statements are supported');
    }

    const { uploadId, rejected } = await ingestStatement({ db, categoriser, userId: req.userId, filename, buffer: file.buffer });
    const [[upload]] = await db.query('SELECT * FROM uploads WHERE id = ? AND user_id = ?', [uploadId, req.userId]);
    res.status(201).json({ upload: toUploadJson(upload), rejected_rows: rejected });
  });

  router.get('/uploads', auth, async (req, res) => {
    const [rows] = await db.query('SELECT * FROM uploads WHERE user_id = ? ORDER BY created_at DESC, id DESC', [req.userId]);
    res.json({ uploads: rows.map(toUploadJson) });
  });

  router.get('/uploads/:id/transactions', auth, async (req, res) => {
    const uploadId = pathId(req.params.id);
    const paging = pagination(req.query);
    const [owned] = await db.query('SELECT id FROM uploads WHERE id = ? AND user_id = ?', [uploadId, req.userId]);
    if (owned.length === 0) throw notFound('Upload not found');
    res.json(await pagedTransactions(db, 'user_id = ? AND upload_id = ?', [req.userId, uploadId], paging));
  });

  router.get('/transactions', auth, async (req, res) => {
    const paging = pagination(req.query);
    const from = isoDate(req.query.from, 'from');
    const to = isoDate(req.query.to, 'to');
    if (from && to && from > to) throw badRequest('from must be on or before to');
    const { category, direction } = req.query;
    if (category !== undefined && !isCategory(category)) throw badRequest('category is not a known category');
    if (direction !== undefined && direction !== 'debit' && direction !== 'credit') {
      throw badRequest('direction must be debit or credit');
    }

    const clauses = ['user_id = ?'];
    const params = [req.userId];
    const addFilter = (clause, value) => {
      if (value === undefined) return;
      clauses.push(clause);
      params.push(value);
    };
    addFilter('txn_date >= ?', from);
    addFilter('txn_date <= ?', to);
    addFilter('category = ?', category);
    addFilter('direction = ?', direction);
    res.json(await pagedTransactions(db, clauses.join(' AND '), params, paging));
  });

  return router;
}
