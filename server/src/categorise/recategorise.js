// Re-runs the normal categoriser over one user's Unidentified rows, e.g. rows uploaded before an
// OpenAI key was set. There's no second categorisation path: the same rules → P2P → cache → one
// batched LLM call as at upload time.
import { UNIDENTIFIED } from '../categories.js';
import { parseNarration } from '../ingest/narration.js';

const UPDATE_CHUNK = 1000;

/**
 * @param {{ db: import('mysql2/promise').Pool, categoriser: { categorise(rows: object[]): Promise<string[]> }, userId: number }} deps
 * @returns {Promise<{ looked: number, changed: number, stillUnidentified: number }>}
 */
export async function recategoriseUser({ db, categoriser, userId }) {
  const [rows] = await db.query(
    'SELECT id, merchant, description_raw, direction, channel FROM transactions WHERE user_id = ? AND category = ? ORDER BY id',
    [userId, UNIDENTIFIED],
  );
  if (rows.length === 0) return { looked: 0, changed: 0, stillUnidentified: 0 };

  const categories = await categoriser.categorise(
    rows.map((r) => {
      // Re-read the narration with today's parser: rows stored before an extraction fix may have a
      // junk merchant ("Dr"). The stored merchant isn't rewritten here; only the category changes.
      const parsed = parseNarration(r.description_raw);
      return {
        merchant: parsed.merchant ?? r.merchant,
        description: r.description_raw,
        direction: r.direction,
        channel: r.channel,
        // P2P isn't stored either. A person's name must never reach the LLM.
        isPerson: parsed.isPerson,
      };
    }),
  );

  // Group the changed ids by their new category, then one UPDATE per category and chunk.
  const byCategory = new Map();
  rows.forEach((r, i) => {
    if (categories[i] === UNIDENTIFIED) return;
    if (!byCategory.has(categories[i])) byCategory.set(categories[i], []);
    byCategory.get(categories[i]).push(r.id);
  });
  let changed = 0;
  for (const [category, ids] of byCategory) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const [res] = await db.query('UPDATE transactions SET category = ? WHERE user_id = ? AND category = ? AND id IN (?)', [
        category,
        userId,
        UNIDENTIFIED,
        ids.slice(i, i + UPDATE_CHUNK),
      ]);
      changed += res.affectedRows;
    }
  }
  return { looked: rows.length, changed, stillUnidentified: rows.length - changed };
}
