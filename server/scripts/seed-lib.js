// Shared by seed:dev and seed:demo: the two synthetic personas, each with a 14-month statement
// ending today (IST). Idempotent: a statement file already ingested for that user is skipped.
import { createHash } from 'node:crypto';
import { ingestStatement } from '../src/ingest/ingest.js';
import { generateStatement, todayIst } from './gen-statement.js';

export const PERSONAS = [
  { email: 'a@test.local', seed: 1 },
  { email: 'b@test.local', seed: 2 },
];

/** What seeding would do, without writing. */
export async function planPersonas(db, end = todayIst()) {
  const plan = [];
  for (const { email, seed } of PERSONAS) {
    const buffer = Buffer.from(generateStatement({ seed, months: 14, end }));
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    const [seen] = users.length ? await db.query('SELECT id FROM uploads WHERE user_id = ? AND file_hash = ? LIMIT 1', [users[0].id, fileHash]) : [[]];
    plan.push({ email, seed, end, buffer, filename: `synthetic-seed${seed}-${end}.csv`, existingUploadId: seen[0]?.id ?? null });
  }
  return plan;
}

export async function seedPersonas({ db, categoriser, plan, log = console.log }) {
  for (const p of plan) {
    await db.query('INSERT INTO users (email) VALUES (?) ON DUPLICATE KEY UPDATE id = id', [p.email]);
    const [[user]] = await db.query('SELECT id FROM users WHERE email = ?', [p.email]);
    if (p.existingUploadId) {
      log(`${p.email} (user ${user.id}): ${p.filename} already uploaded as upload ${p.existingUploadId}; skipped`);
      continue;
    }
    const { uploadId } = await ingestStatement({ db, categoriser, userId: user.id, filename: p.filename, buffer: p.buffer });
    const [[u]] = await db.query('SELECT rows_total, rows_inserted, rows_duplicate, rows_rejected FROM uploads WHERE id = ?', [uploadId]);
    log(
      `${p.email} (user ${user.id}): upload ${uploadId} ${p.filename} — total ${u.rows_total}, inserted ${u.rows_inserted}, duplicate ${u.rows_duplicate}, rejected ${u.rows_rejected}`,
    );
  }
}
