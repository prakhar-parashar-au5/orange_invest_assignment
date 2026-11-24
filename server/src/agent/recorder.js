// Writes AI traces: one ai_traces row per chat turn, plus one row per model call and per tool call.
// - Each call row is written as an attempt *before* it runs, then updated with the outcome, so a
//   crash leaves an IN_PROGRESS row instead of nothing.
// - scrub() runs on everything stored: keys that look secret are dropped.
// - Provider errors are stored as the error class plus HTTP status. Their messages are never stored.
// - Callers fail closed: if a write here throws, the chat turn fails with 502.

// v2 (BE-012): 'transactions' means every direction and category; spend_only only for spend questions.
export const PROMPT_VERSION = 'v2';
const MAX_RESULT_CHARS = 4000;
const SECRET_KEY = /key|token|secret|password|authorization|cookie/i;
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** Deep copy with every object key matching SECRET_KEY removed. */
export function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

function capped(value) {
  const s = JSON.stringify(scrub(value) ?? null);
  return s.length <= MAX_RESULT_CHARS ? s : JSON.stringify({ truncated: true, preview: s.slice(0, MAX_RESULT_CHARS) });
}

/** Error class and provider HTTP status only. */
export function errorFacts(err) {
  return {
    errorClass: SAFE_NAME.test(err?.name ?? '') ? err.name : 'Error',
    providerHttpStatus: Number.isInteger(err?.status) ? err.status : null,
  };
}

/** @param {{ db: import('mysql2/promise').Pool }} deps */
export function createRecorder({ db }) {
  return {
    async startTrace({ userId, conversationId, userMessageId, model, promptVersion = PROMPT_VERSION }) {
      const [r] = await db.query(
        "INSERT INTO ai_traces (user_id, conversation_id, user_message_id, model, prompt_version, status) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS')",
        [userId, conversationId, userMessageId, model, promptVersion],
      );
      return r.insertId;
    },

    async startModelCall(traceId, { seq, model }) {
      const [r] = await db.query("INSERT INTO ai_model_calls (trace_id, seq, model, status) VALUES (?, ?, ?, 'IN_PROGRESS')", [traceId, seq, model]);
      return r.insertId;
    },

    async finishModelCall(id, { status, tokensIn = null, tokensOut = null, latencyMs, finishReason = null, requestedTools = 0, err = null }) {
      const e = err ? errorFacts(err) : { errorClass: null, providerHttpStatus: null };
      await db.query(
        `UPDATE ai_model_calls SET status = ?, tokens_in = ?, tokens_out = ?, latency_ms = ?, finish_reason = ?,
           requested_tools = ?, error_class = ?, provider_http_status = ? WHERE id = ?`,
        [status, tokensIn, tokensOut, latencyMs, finishReason?.slice(0, 32) ?? null, requestedTools, e.errorClass, e.providerHttpStatus, id],
      );
    },

    /** args = parsed arguments, or the INVALID_JSON marker */
    async startToolCall(traceId, { seq, round, name, args }) {
      const [r] = await db.query(
        "INSERT INTO ai_tool_calls (trace_id, seq, round, name, args_json, status) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS')",
        [traceId, seq, round, String(name ?? '').slice(0, 64), capped(args)],
      );
      return r.insertId;
    },

    async finishToolCall(id, { status, validationStatus, result, latencyMs, error = null }) {
      await db.query('UPDATE ai_tool_calls SET status = ?, validation_status = ?, result_json = ?, latency_ms = ?, error = ? WHERE id = ?', [
        status,
        validationStatus,
        result === undefined ? null : capped(result),
        latencyMs,
        error ? String(error).slice(0, 300) : null,
        id,
      ]);
    },

    /**
     * @param {object} outcome
     * @param {import('mysql2/promise').PoolConnection} [conn] to commit together with the assistant message
     */
    async finishTrace(traceId, { status, errorStage = null, err = null, rounds = 0, tokensIn = 0, tokensOut = 0, latencyMs, assistantMessageId = null }, conn = db) {
      const e = err ? errorFacts(err) : { errorClass: null, providerHttpStatus: null };
      await conn.query(
        `UPDATE ai_traces SET status = ?, error_stage = ?, error_class = ?, provider_http_status = ?, rounds = ?,
           tokens_in = ?, tokens_out = ?, latency_ms = ?, assistant_message_id = ?, finished_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [status, errorStage, e.errorClass, e.providerHttpStatus, rounds, tokensIn, tokensOut, latencyMs, assistantMessageId, traceId],
      );
    },
  };
}

export const INVALID_JSON = Object.freeze({ invalidJson: true });

/**
 * Hooks for one turn, for the agent loop. Every recorder failure is tagged stage = 'record', so the
 * route can tell "the AI failed" from "we couldn't record it".
 */
export function traceHooks(recorder, traceId) {
  const tagged =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        err.stage = 'record';
        throw err;
      }
    };
  return {
    modelStart: tagged((info) => recorder.startModelCall(traceId, info)),
    modelEnd: tagged((id, outcome) => recorder.finishModelCall(id, outcome)),
    toolStart: tagged((info) => recorder.startToolCall(traceId, info)),
    toolEnd: tagged((id, outcome) => recorder.finishToolCall(id, outcome)),
  };
}
