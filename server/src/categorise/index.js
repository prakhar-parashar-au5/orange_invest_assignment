// The categoriser that ingestion (BE-003) calls once per upload:
//
//   const categoriser = createCategoriser({ db, classifier, logger });
//   const categories = await categoriser.categorise(rows); // same order as rows
//
// For each row: rules → merchant cache → one batched LLM call for the merchants still unknown →
// Unidentified. It never throws because of the LLM: a missing key or a failed call means
// Unidentified plus a warning, and the upload still succeeds.
import { isCategory, UNIDENTIFIED, TRANSFERS_OTHERS } from '../categories.js';
import { ruleCategory, normaliseText } from './rules.js';
import { createOpenAiClassifier } from './openai-classifier.js';
import { describeError } from '../util/log-error.js';

const MAX_KEY_LENGTH = 120;
// Rail, direction and filler tokens that extraction can leave behind. Never sent, never cached (TE-003).
const STOP_KEYS = new Set(['DR', 'CR', 'P2A', 'P2M', 'IFT', 'MB', 'UPI', 'IMPS', 'NEFT', 'RTGS', 'PAY', 'CLIENT', 'SETTLEMENT', 'VPA', 'UTR', 'TRANSFER']);
const usableKey = (key) => key !== null && !STOP_KEYS.has(key) && !/^\p{L}{1,2}$/u.test(key);

/**
 * The cache key and the only thing sent to the LLM: the merchant name uppercased, punctuation
 * collapsed, and runs of 5+ digits (refs, phone numbers, account numbers) removed.
 * @returns {string|null}
 */
export function merchantKey(merchant) {
  if (merchant == null) return null;
  const key = normaliseText(merchant)
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEY_LENGTH)
    .trim();
  return key.length > 0 ? key : null;
}

/**
 * @param {{
 *   db: import('mysql2/promise').Pool | null,
 *   classifier: { classify(names: string[]): Promise<(string|null)[]> } | null,
 *   logger?: { warn: Function },
 * }} deps
 */
export function createCategoriser({ db, classifier, logger = console }) {
  async function lookupCache(keys) {
    if (keys.length === 0) return new Map();
    const [rows] = await db.query('SELECT merchant_key, category FROM merchant_categories WHERE merchant_key IN (?)', [keys]);
    // Old Unidentified rows (cached before BE-012) are ignored, so those merchants get asked again.
    return new Map(rows.filter((r) => isCategory(r.category) && r.category !== UNIDENTIFIED).map((r) => [r.merchant_key, r.category]));
  }

  async function saveCache(entries) {
    if (entries.length === 0) return;
    // First writer wins. A concurrent upload classifying the same merchant is harmless.
    await db.query('INSERT INTO merchant_categories (merchant_key, category, source) VALUES ? ON DUPLICATE KEY UPDATE id = id', [
      entries.map(([key, category]) => [key, category, 'llm']),
    ]);
  }

  async function classifyUnknown(keys) {
    const answers = new Map();
    if (keys.length === 0) return answers;
    if (!classifier) {
      logger.warn(`categoriser: OPENAI_API_KEY not set; ${keys.length} merchant(s) left as ${UNIDENTIFIED}`);
      return answers;
    }
    let results;
    try {
      results = await classifier.classify(keys);
    } catch (err) {
      logger.warn(`categoriser: LLM fallback failed (${describeError(err)}); ${keys.length} merchant(s) left as ${UNIDENTIFIED}`);
      return answers;
    }
    const toCache = [];
    keys.forEach((key, i) => {
      const answer = results?.[i];
      // Only real answers are cached. Invalid, missing or Unidentified ones are asked again next upload.
      if (isCategory(answer)) answers.set(key, answer);
      if (isCategory(answer) && answer !== UNIDENTIFIED) toCache.push([key, answer]);
    });
    await saveCache(toCache);
    return answers;
  }

  return {
    /**
     * @param {{ merchant?: string|null, description?: string|null, direction: 'debit'|'credit', channel?: string, isPerson?: boolean }[]} rows
     * @returns {Promise<string[]>}
     */
    async categorise(rows) {
      if (rows.length === 0) return [];

      const byRule = rows.map((row) => ruleCategory(row) ?? (row.isPerson ? TRANSFERS_OTHERS : null));
      // P2P payees never get a key, so a person's name is never looked up, sent to the LLM or cached.
      const keys = rows.map((row, i) => {
        if (byRule[i]) return null;
        const key = merchantKey(row.merchant);
        return usableKey(key) ? key : null;
      });
      const pending = [...new Set(keys.filter(Boolean))];

      const cached = await lookupCache(pending);
      const fromLlm = await classifyUnknown(pending.filter((k) => !cached.has(k)));

      return rows.map((_, i) => byRule[i] ?? cached.get(keys[i]) ?? fromLlm.get(keys[i]) ?? UNIDENTIFIED);
    },
  };
}

/**
 * Production wiring: an OpenAI classifier when OPENAI_API_KEY is set, otherwise none (rules + cache only).
 * @param {{ config: { openaiApiKey: string|null, openaiModel: string }, db: import('mysql2/promise').Pool, logger?: { warn: Function } }} deps
 */
export function categoriserFromConfig({ config, db, logger = console }) {
  const classifier = createOpenAiClassifier({ apiKey: config.openaiApiKey, model: config.openaiModel });
  return createCategoriser({ db, classifier, logger });
}
