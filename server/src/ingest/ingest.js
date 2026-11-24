// One upload, end to end: parse → dedup hash → categorise → store, all in one DB transaction.
// Every write carries the userId that came from the session.
import { createHash } from 'node:crypto';
import { parseStatement } from './parse-statement.js';

const MAX_REJECTED_IN_RESPONSE = 50;
const INSERT_CHUNK = 1000;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/**
 * dedup_hash = sha256(user, account, date, amount, direction, normalised description, occurrence).
 * The occurrence number counts identical rows earlier in the same file, so two genuinely identical
 * rows (the same chai on the same day) both survive. Re-uploading the file, or a statement that
 * overlaps it, produces the same hashes and so inserts nothing twice.
 * The account is '' for now: the generic bank CSV has no account column.
 */
export function withDedupHashes(userId, rows, account = '') {
  const seen = new Map();
  return rows.map((row) => {
    const identity = [account, row.txn_date, row.amount_paise, row.direction, row.description_raw.toUpperCase()].join('\u001f');
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return { ...row, dedup_hash: sha256(`${userId}\u001f${identity}\u001f${occurrence}`) };
  });
}

/**
 * @param {{ db: import('mysql2/promise').Pool, categoriser: { categorise(rows: object[]): Promise<string[]> },
 *           userId: number, filename: string, buffer: Buffer }} args
 */
export async function ingestStatement({ db, categoriser, userId, filename, buffer }) {
  // Throws a 422 HttpError for whole-file problems, before anything is written.
  const parsed = parseStatement(buffer);
  const rows = withDedupHashes(userId, parsed.rows);

  // Skip rows the user already has before calling the categoriser, so a re-upload costs no LLM call.
  const existing = new Set();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const hashes = rows.slice(i, i + INSERT_CHUNK).map((r) => r.dedup_hash);
    const [found] = await db.query('SELECT dedup_hash FROM transactions WHERE user_id = ? AND dedup_hash IN (?)', [userId, hashes]);
    for (const f of found) existing.add(f.dedup_hash);
  }
  const fresh = rows.filter((r) => !existing.has(r.dedup_hash));
  const categories = await categoriser.categorise(
    fresh.map((r) => ({
      merchant: r.merchant,
      description: r.description_raw,
      direction: r.direction,
      channel: r.channel,
      isPerson: r.isPerson,
    })),
  );

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [up] = await conn.query(
      'INSERT INTO uploads (user_id, filename, file_hash, source_format, rows_total, rows_rejected) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, filename, sha256(buffer), parsed.format, parsed.total, parsed.rejected.length],
    );
    const uploadId = up.insertId;

    for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
      const values = fresh.slice(i, i + INSERT_CHUNK).map((r, j) => [
        userId,
        uploadId,
        r.source,
        r.txn_date,
        r.description_raw,
        r.merchant,
        categories[i + j],
        r.amount_paise,
        r.direction,
        r.balance_paise,
        r.channel,
        r.ref,
        JSON.stringify(r.raw),
        r.dedup_hash,
      ]);
      // A concurrent upload of the same rows can win the race. The unique key catches it, and
      // `id = id` turns that into a no-op instead of an error.
      await conn.query(
        `INSERT INTO transactions (user_id, upload_id, source, txn_date, description_raw, merchant, category,
           amount_paise, direction, balance_paise, channel, ref, raw_json, dedup_hash)
         VALUES ? ON DUPLICATE KEY UPDATE id = id`,
        [values],
      );
    }

    const [[{ inserted }]] = await conn.query('SELECT COUNT(*) AS inserted FROM transactions WHERE upload_id = ? AND user_id = ?', [
      uploadId,
      userId,
    ]);
    await conn.query('UPDATE uploads SET rows_inserted = ?, rows_duplicate = ? WHERE id = ? AND user_id = ?', [
      inserted,
      rows.length - inserted,
      uploadId,
      userId,
    ]);
    await conn.commit();

    return { uploadId, rejected: parsed.rejected.slice(0, MAX_REJECTED_IN_RESPONSE) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
