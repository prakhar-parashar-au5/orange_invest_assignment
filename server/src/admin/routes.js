// Admin AI observability endpoints (API-CONTRACT.md v1.4, "Admin AI"). Admin only: requireAdmin
// re-reads the role on every request. These read across all users by design. The list never returns
// message text; the detail view does.
import { Router } from 'express';
import moment from 'moment-timezone';
import { HttpError, badRequest, notFound } from '../http/errors.js';
import { requireAdmin } from '../auth/session.js';
import { toIstIso } from '../util/time.js';
import { isValidYmd } from '../ingest/dates.js';
import { TZ } from '../agent/periods.js';

/** USD per 1M tokens. An estimate for the dashboard, not a bill. Unknown models cost 0. */
export const MODEL_PRICES = {
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4.1-nano': { in: 0.1, out: 0.4 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10.0 },
};

const WINDOWS = {
  '24h': { buckets: 24, unit: 'hour', sqlFormat: '%Y-%m-%dT%H:00', jsFormat: 'YYYY-MM-DDTHH:00' },
  '7d': { buckets: 7, unit: 'day', sqlFormat: '%Y-%m-%d', jsFormat: 'YYYY-MM-DD' },
  '30d': { buckets: 30, unit: 'day', sqlFormat: '%Y-%m-%d', jsFormat: 'YYYY-MM-DD' },
};
const STATUSES = ['IN_PROGRESS', 'SUCCEEDED', 'FAILED'];
const VERDICTS = ['good', 'bad', 'needs_fix'];
const IST_SQL = "CONVERT_TZ(t.created_at, '+00:00', '+05:30')";

const isoOrNull = (d) => (d ? toIstIso(d) : null);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const parseJson = (v) => (v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v);
const utcSql = (m) => m.clone().utc().format('YYYY-MM-DD HH:mm:ss.SSS');

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function pathId(value) {
  if (!/^\d{1,15}$/.test(value) || Number(value) <= 0) throw notFound('Trace not found');
  return Number(value);
}
function positiveInt(value, name, { max, fallback }) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw badRequest(`${name} must be a whole number from 1 to ${max}`);
  }
  return Number(value);
}
function istDate(value, name) {
  if (value === undefined) return undefined;
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]))) throw badRequest(`${name} must be a date as YYYY-MM-DD`);
  return value;
}

const TRACE_ROW_SQL = `
  SELECT t.*, u.email AS user_email, r.verdict AS review_verdict,
         (SELECT COUNT(*) FROM ai_tool_calls c WHERE c.trace_id = t.id) AS tool_call_count,
         (SELECT GROUP_CONCAT(DISTINCT c.name ORDER BY c.name) FROM ai_tool_calls c WHERE c.trace_id = t.id) AS tool_names
    FROM ai_traces t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN ai_trace_reviews r ON r.trace_id = t.id`;

const toTraceRow = (t) => ({
  id: t.id,
  created_at: toIstIso(t.created_at),
  finished_at: isoOrNull(t.finished_at),
  status: t.status,
  error_stage: t.error_stage,
  error_class: t.error_class,
  provider_http_status: t.provider_http_status,
  model: t.model,
  prompt_version: t.prompt_version,
  rounds: t.rounds,
  tokens_in: t.tokens_in,
  tokens_out: t.tokens_out,
  latency_ms: t.status === 'IN_PROGRESS' ? null : t.latency_ms,
  user_id: t.user_id,
  user_email: t.user_email,
  conversation_id: t.conversation_id,
  tool_names: t.tool_names ? t.tool_names.split(',') : [],
  tool_call_count: num(t.tool_call_count),
  review_verdict: t.review_verdict ?? null,
});

const toReviewJson = (r) =>
  r ? { verdict: r.verdict, note: r.note, reviewer_id: r.reviewer_id, version: r.version, updated_at: toIstIso(r.updated_at) } : null;

export function adminRouter({ config, db }) {
  const router = Router();
  router.use('/admin', requireAdmin(config, db));

  router.get('/admin/ai/summary', async (req, res) => {
    const windowKey = req.query.window ?? '24h';
    const w = WINDOWS[windowKey];
    if (!w) throw badRequest('window must be 24h, 7d or 30d');
    const now = moment().tz(TZ);
    const first = now.clone().startOf(w.unit).subtract(w.buckets - 1, w.unit);
    const from = windowKey === '24h' ? now.clone().subtract(24, 'hours') : first;
    const range = [utcSql(from), utcSql(now)];
    const where = 't.created_at BETWEEN ? AND ?';

    const [byStatus] = await db.query(`SELECT t.status, COUNT(*) AS n FROM ai_traces t WHERE ${where} GROUP BY t.status`, range);
    const [byStage] = await db.query(
      `SELECT t.error_stage AS stage, COUNT(*) AS n FROM ai_traces t WHERE ${where} AND t.status = 'FAILED' GROUP BY t.error_stage`,
      range,
    );
    const [latencies] = await db.query(
      `SELECT t.latency_ms FROM ai_traces t WHERE ${where} AND t.status <> 'IN_PROGRESS' AND t.latency_ms IS NOT NULL ORDER BY t.latency_ms`,
      range,
    );
    const [tokens] = await db.query(
      `SELECT t.model, SUM(t.tokens_in) AS tin, SUM(t.tokens_out) AS tout FROM ai_traces t WHERE ${where} GROUP BY t.model`,
      range,
    );
    const [tools] = await db.query(
      `SELECT c.name, COUNT(*) AS calls, SUM(c.status = 'FAILED') AS failed, SUM(c.status = 'REJECTED') AS rejected
         FROM ai_tool_calls c JOIN ai_traces t ON t.id = c.trace_id WHERE ${where}
        GROUP BY c.name ORDER BY calls DESC, c.name`,
      range,
    );
    const [reviews] = await db.query(
      `SELECT r.verdict, COUNT(*) AS n FROM ai_trace_reviews r JOIN ai_traces t ON t.id = r.trace_id WHERE ${where} GROUP BY r.verdict`,
      range,
    );
    const [series] = await db.query(
      `SELECT DATE_FORMAT(${IST_SQL}, '${w.sqlFormat}') AS bucket, COUNT(*) AS n, SUM(t.status = 'FAILED') AS failed
         FROM ai_traces t WHERE t.created_at BETWEEN ? AND ? GROUP BY bucket`,
      [utcSql(first), utcSql(now)],
    );

    const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of byStatus) statusCounts[r.status] = num(r.n);
    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const sorted = latencies.map((r) => num(r.latency_ms));
    let tin = 0;
    let tout = 0;
    let cost = 0;
    for (const r of tokens) {
      tin += num(r.tin);
      tout += num(r.tout);
      const price = MODEL_PRICES[r.model];
      if (price) cost += (num(r.tin) * price.in + num(r.tout) * price.out) / 1e6;
    }
    const reviewCounts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
    for (const r of reviews) reviewCounts[r.verdict] = num(r.n);
    const reviewed = VERDICTS.reduce((s, v) => s + reviewCounts[v], 0);
    const seriesMap = new Map(series.map((r) => [r.bucket, r]));

    res.json({
      window: windowKey,
      from: toIstIso(from.toDate()),
      to: toIstIso(now.toDate()),
      traces: {
        total,
        by_status: statusCounts,
        failures_by_stage: Object.fromEntries(byStage.map((r) => [r.stage ?? 'internal', num(r.n)])),
      },
      latency_ms: { p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted.at(-1) ?? null },
      tokens: { in: tin, out: tout },
      estimated_cost_usd: Math.round(cost * 1e6) / 1e6,
      tools: tools.map((r) => ({ name: r.name, calls: num(r.calls), failed: num(r.failed), rejected: num(r.rejected) })),
      reviews: { ...reviewCounts, unreviewed: total - reviewed },
      series: Array.from({ length: w.buckets }, (_, i) => {
        const start = first.clone().add(i, w.unit);
        const hit = seriesMap.get(start.format(w.jsFormat));
        return { bucket_start: toIstIso(start.toDate()), traces: num(hit?.n) ?? 0, failed: num(hit?.failed) ?? 0 };
      }),
    });
  });

  router.get('/admin/ai/traces', async (req, res) => {
    const page = positiveInt(req.query.page, 'page', { max: 1_000_000, fallback: 1 });
    const pageSize = positiveInt(req.query.page_size, 'page_size', { max: 200, fallback: 50 });
    const from = istDate(req.query.from, 'from');
    const to = istDate(req.query.to, 'to');
    if (from && to && from > to) throw badRequest('from must be on or before to');
    const { status, model, tool } = req.query;
    if (status !== undefined && !STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`);
    if (model !== undefined && (typeof model !== 'string' || model.length > 64)) throw badRequest('model is invalid');
    if (tool !== undefined && (typeof tool !== 'string' || tool.length > 64)) throw badRequest('tool is invalid');
    const userId = req.query.user_id === undefined ? undefined : positiveInt(req.query.user_id, 'user_id', { max: Number.MAX_SAFE_INTEGER });

    const clauses = ['1 = 1'];
    const params = [];
    const add = (sql, ...values) => {
      clauses.push(sql);
      params.push(...values);
    };
    if (from) add(`DATE(${IST_SQL}) >= ?`, from);
    if (to) add(`DATE(${IST_SQL}) <= ?`, to);
    if (status) add('t.status = ?', status);
    if (model) add('t.model = ?', model);
    if (tool) add('EXISTS (SELECT 1 FROM ai_tool_calls c WHERE c.trace_id = t.id AND c.name = ?)', tool);
    if (userId) add('t.user_id = ?', userId);
    const where = clauses.join(' AND ');

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM ai_traces t WHERE ${where}`, params);
    const [rows] = await db.query(`${TRACE_ROW_SQL} WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`, [
      ...params,
      pageSize,
      (page - 1) * pageSize,
    ]);
    res.json({ traces: rows.map(toTraceRow), page, page_size: pageSize, total: num(total) });
  });

  router.get('/admin/ai/traces/:id', async (req, res) => {
    const id = pathId(req.params.id);
    const [[t]] = await db.query(`${TRACE_ROW_SQL} WHERE t.id = ?`, [id]);
    if (!t) throw notFound('Trace not found');
    const msg = async (mid) => {
      if (!mid) return null;
      const [[m]] = await db.query('SELECT id, content, created_at FROM messages WHERE id = ?', [mid]);
      return m ? { id: m.id, content: m.content, created_at: toIstIso(m.created_at) } : null;
    };
    const [models] = await db.query('SELECT * FROM ai_model_calls WHERE trace_id = ?', [id]);
    const [tools] = await db.query('SELECT * FROM ai_tool_calls WHERE trace_id = ?', [id]);
    const timeline = [
      ...models.map((m) => ({
        type: 'model_call',
        seq: m.seq,
        model: m.model,
        status: m.status,
        finish_reason: m.finish_reason,
        requested_tools: m.requested_tools,
        tokens_in: m.tokens_in,
        tokens_out: m.tokens_out,
        latency_ms: m.latency_ms,
        error_class: m.error_class,
        provider_http_status: m.provider_http_status,
      })),
      ...tools.map((c) => ({
        type: 'tool_call',
        seq: c.seq,
        round: c.round,
        name: c.name,
        status: c.status,
        validation_status: c.validation_status,
        args: parseJson(c.args_json),
        result: parseJson(c.result_json),
        error: c.error,
        latency_ms: c.latency_ms,
      })),
    ].sort((a, b) => a.seq - b.seq);
    const [[prev]] = await db.query('SELECT id FROM ai_traces WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 1', [t.conversation_id, id]);
    const [[next]] = await db.query('SELECT id FROM ai_traces WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 1', [t.conversation_id, id]);
    const [[review]] = await db.query('SELECT * FROM ai_trace_reviews WHERE trace_id = ?', [id]);

    res.json({
      trace: toTraceRow(t),
      user_message: await msg(t.user_message_id),
      assistant_message: await msg(t.assistant_message_id),
      timeline,
      tokens: { in: t.tokens_in, out: t.tokens_out },
      prev_trace_id: prev?.id ?? null,
      next_trace_id: next?.id ?? null,
      review: toReviewJson(review),
    });
  });

  router.put('/admin/ai/traces/:id/review', async (req, res) => {
    const id = pathId(req.params.id);
    const { verdict, note = '', expectedVersion } = req.body ?? {};
    if (!VERDICTS.includes(verdict)) throw badRequest(`verdict must be one of ${VERDICTS.join(', ')}`);
    if (typeof note !== 'string' || note.length > 2000) throw badRequest('note must be a string of at most 2000 characters');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw badRequest('expectedVersion must be a non-negative integer');
    const [[t]] = await db.query('SELECT id FROM ai_traces WHERE id = ?', [id]);
    if (!t) throw notFound('Trace not found');

    const stale = () => new HttpError(409, 'STALE_REVIEW', 'This review was changed by someone else. Reload and try again.');
    if (expectedVersion === 0) {
      try {
        await db.query('INSERT INTO ai_trace_reviews (trace_id, verdict, note, reviewer_id, version) VALUES (?, ?, ?, ?, 1)', [
          id,
          verdict,
          note,
          req.userId,
        ]);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') throw stale();
        throw err;
      }
    } else {
      // Compare-and-set on the version, so two reviewers can't silently overwrite each other.
      const [r] = await db.query(
        'UPDATE ai_trace_reviews SET verdict = ?, note = ?, reviewer_id = ?, version = version + 1 WHERE trace_id = ? AND version = ?',
        [verdict, note, req.userId, id, expectedVersion],
      );
      if (r.affectedRows === 0) throw stale();
    }
    const [[review]] = await db.query('SELECT * FROM ai_trace_reviews WHERE trace_id = ?', [id]);
    res.json({ review: toReviewJson(review) });
  });

  router.delete('/admin/ai/traces/:id', async (req, res) => {
    const id = pathId(req.params.id);
    if (req.query.confirm !== 'true') throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Add ?confirm=true to delete this trace');
    const [r] = await db.query('DELETE FROM ai_traces WHERE id = ?', [id]);
    if (r.affectedRows === 0) throw notFound('Trace not found');
    res.status(204).end();
  });

  // ---------- evals (BE-010) ----------
  const toRunJson = (r) => ({
    id: r.id,
    label: r.label,
    model: r.model,
    prompt_version: r.prompt_version,
    status: r.status,
    started_at: toIstIso(r.started_at),
    finished_at: isoOrNull(r.finished_at),
    cases_total: r.cases_total,
    cases_passed: r.cases_passed,
    cases_failed: r.cases_failed,
    cases_blocked: r.cases_blocked,
  });

  router.get('/admin/evals', async (_req, res) => {
    const [rows] = await db.query('SELECT * FROM eval_runs ORDER BY started_at DESC, id DESC LIMIT 100');
    res.json({ runs: rows.map(toRunJson) });
  });

  router.get('/admin/evals/:id', async (req, res) => {
    if (!/^\d{1,15}$/.test(req.params.id)) throw notFound('Eval run not found');
    const [[run]] = await db.query('SELECT * FROM eval_runs WHERE id = ?', [Number(req.params.id)]);
    if (!run) throw notFound('Eval run not found');
    const [rows] = await db.query('SELECT * FROM eval_results WHERE run_id = ? ORDER BY id', [run.id]);
    const cases = new Map();
    for (const r of rows) {
      if (!cases.has(r.case_id)) cases.set(r.case_id, { case_id: r.case_id, risk: r.risk, persona: r.persona, results: [] });
      cases.get(r.case_id).results.push({
        attempt: r.attempt,
        verdict: r.verdict,
        latency_ms: r.latency_ms,
        trace_id: r.trace_id,
        answer_text: r.answer_text,
        gates: parseJson(r.gates_json),
      });
    }
    res.json({
      run: toRunJson(run),
      cases: [...cases.values()].map((c) => {
        const passed = c.results.filter((x) => x.verdict === 'pass').length;
        const verdict = c.results.some((x) => x.verdict === 'blocked') ? 'blocked' : passed === c.results.length ? 'pass' : 'fail';
        return { ...c, verdict, attempts: c.results.length, passed_attempts: passed, pass_rate: Math.round((passed / c.results.length) * 100) / 100 };
      }),
    });
  });

  return router;
}
