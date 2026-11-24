import { http, HttpResponse } from 'msw'
import { API_URL } from '../api/config'
import { db, nowIso } from './db'

// MSW handlers for API-CONTRACT v1.4 "Admin AI" and v1.5 "Admin evals".
// The summary is computed from the seeded traces so the numbers stay consistent with the list.

const url = (p) => `${API_URL}/api${p}`
const err = (status, code, message) => HttpResponse.json({ error: { code, message } }, { status })

// FE-006 / BE-016: every logged-in user may read the AI dashboard and review; delete is admin-only.
function loggedIn(fn) {
  return async (info) => {
    const s = db()
    const user = s.users.find((u) => u.id === s.sessionUserId)
    if (!user) return err(401, 'UNAUTHENTICATED', 'Please log in.')
    return fn({ ...info, user })
  }
}

function admin(fn) {
  return loggedIn((info) => (info.user.role === 'admin' ? fn(info) : err(403, 'FORBIDDEN', 'Admins only.')))
}

const WINDOWS = { '24h': 24, '7d': 7, '30d': 30 }
const STATUSES = ['IN_PROGRESS', 'SUCCEEDED', 'FAILED']

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

function summary(window) {
  const rows = db().admin.traces.map((x) => x.row)
  const by_status = { SUCCEEDED: 0, FAILED: 0, IN_PROGRESS: 0 }
  const failures_by_stage = {}
  const tools = new Map()
  const reviews = { good: 0, bad: 0, needs_fix: 0, unreviewed: 0 }
  let tin = 0, tout = 0
  for (const r of rows) {
    by_status[r.status]++
    if (r.status === 'FAILED') failures_by_stage[r.error_stage] = (failures_by_stage[r.error_stage] || 0) + 1
    tin += r.tokens_in
    tout += r.tokens_out
    if (r.review_verdict) reviews[r.review_verdict]++
    else reviews.unreviewed++
  }
  for (const tr of db().admin.traces) {
    for (const step of tr.timeline) {
      if (step.type !== 'tool_call') continue
      const t = tools.get(step.name) || { name: step.name, calls: 0, failed: 0, rejected: 0 }
      t.calls++
      if (step.status === 'FAILED') t.failed++
      if (step.status === 'REJECTED') t.rejected++
      tools.set(step.name, t)
    }
  }
  const lat = rows.filter((r) => r.latency_ms !== null).map((r) => r.latency_ms).sort((a, b) => a - b)
  const n = WINDOWS[window]
  const series = Array.from({ length: n }, (_, i) => ({
    bucket_start: window === '24h'
      ? `2026-11-24T${String(i).padStart(2, '0')}:00:00+05:30`
      : `2026-11-${String(25 - n + i).padStart(2, '0')}T00:00:00+05:30`,
    traces: 0,
    failed: 0,
  }))
  // All seeded traces are from the last bucket.
  series[n - 1].traces = rows.length
  series[n - 1].failed = by_status.FAILED
  return {
    window,
    from: window === '24h' ? '2026-11-23T23:15:00+05:30' : `2026-11-${String(25 - n).padStart(2, '0')}T23:15:00+05:30`,
    to: '2026-11-24T23:15:00+05:30',
    traces: { total: rows.length, by_status, failures_by_stage },
    latency_ms: { p50: percentile(lat, 50), p95: percentile(lat, 95), max: lat.length ? lat[lat.length - 1] : null },
    tokens: { in: tin, out: tout },
    estimated_cost_usd: Number(((tin * 0.4 + tout * 1.6) / 1e6).toFixed(6)),
    tools: [...tools.values()].sort((a, b) => b.calls - a.calls),
    reviews,
    series,
  }
}

function findTrace(id) {
  return db().admin.traces.find((x) => x.row.id === Number(id))
}

export const adminHandlers = [
  http.get(
    url('/admin/ai/summary'),
    loggedIn(({ request }) => {
      const w = new URL(request.url).searchParams.get('window') || '24h'
      if (!WINDOWS[w]) return err(400, 'VALIDATION_ERROR', 'window must be 24h, 7d or 30d')
      return HttpResponse.json(summary(w))
    }),
  ),

  http.get(
    url('/admin/ai/traces'),
    loggedIn(({ request }) => {
      const q = new URL(request.url).searchParams
      const status = q.get('status')
      if (status && !STATUSES.includes(status)) return err(400, 'VALIDATION_ERROR', 'bad status')
      let rows = db().admin.traces.map((x) => x.row)
      const from = q.get('from'), to = q.get('to'), model = q.get('model'), tool = q.get('tool'), userId = q.get('user_id')
      if (from) rows = rows.filter((r) => r.created_at.slice(0, 10) >= from)
      if (to) rows = rows.filter((r) => r.created_at.slice(0, 10) <= to)
      if (status) rows = rows.filter((r) => r.status === status)
      if (model) rows = rows.filter((r) => r.model === model)
      if (tool) rows = rows.filter((r) => r.tool_names.includes(tool))
      if (userId) rows = rows.filter((r) => r.user_id === Number(userId))
      const page = Number(q.get('page') || 1)
      const pageSize = Number(q.get('page_size') || 50)
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
        return err(400, 'VALIDATION_ERROR', 'bad page or page_size')
      }
      rows = [...rows].sort((a, b) => b.id - a.id)
      return HttpResponse.json({
        traces: rows.slice((page - 1) * pageSize, page * pageSize),
        page,
        page_size: pageSize,
        total: rows.length,
      })
    }),
  ),

  http.get(
    url('/admin/ai/traces/:id'),
    loggedIn(({ params }) => {
      const tr = findTrace(params.id)
      if (!tr) return err(404, 'NOT_FOUND', 'Trace not found.')
      const { row, ...rest } = tr
      return HttpResponse.json({ trace: row, ...rest, tokens: { in: row.tokens_in, out: row.tokens_out } })
    }),
  ),

  http.put(
    url('/admin/ai/traces/:id/review'),
    loggedIn(async ({ params, request, user }) => {
      const tr = findTrace(params.id)
      if (!tr) return err(404, 'NOT_FOUND', 'Trace not found.')
      const body = await request.json().catch(() => ({}))
      const { verdict, note = '', expectedVersion } = body || {}
      if (!['good', 'bad', 'needs_fix'].includes(verdict) || typeof note !== 'string' || note.length > 2000 ||
          !Number.isInteger(expectedVersion) || expectedVersion < 0) {
        return err(400, 'VALIDATION_ERROR', 'bad verdict, note or expectedVersion')
      }
      const current = tr.review?.version ?? 0
      if (expectedVersion !== current) {
        return err(409, 'STALE_REVIEW', 'Someone saved a newer review. Reload and try again.')
      }
      tr.review = { verdict, note, reviewer_id: user.id, version: current + 1, updated_at: nowIso() }
      tr.row.review_verdict = verdict
      return HttpResponse.json({ review: tr.review })
    }),
  ),

  http.delete(
    url('/admin/ai/traces/:id'),
    admin(({ params, request }) => {
      if (new URL(request.url).searchParams.get('confirm') !== 'true') {
        return err(400, 'CONFIRMATION_REQUIRED', 'Add confirm=true to delete.')
      }
      const s = db()
      const idx = s.admin.traces.findIndex((x) => x.row.id === Number(params.id))
      if (idx < 0) return err(404, 'NOT_FOUND', 'Trace not found.')
      s.admin.traces.splice(idx, 1)
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.get(url('/admin/evals'), loggedIn(() => HttpResponse.json({ runs: db().admin.evalRuns.map((r) => r.run) }))),

  http.get(
    url('/admin/evals/:id'),
    loggedIn(({ params }) => {
      const r = db().admin.evalRuns.find((x) => x.run.id === Number(params.id))
      if (!r) return err(404, 'NOT_FOUND', 'Eval run not found.')
      return HttpResponse.json(r)
    }),
  ),
]
