import { request } from './client'

// Admin endpoints, API-CONTRACT v1.4 "Admin AI" and v1.5 "Admin evals". All need role = admin;
// a non-admin gets 403 FORBIDDEN, which the screens render.

export const getAiSummary = (window = '24h') => request('/admin/ai/summary', { query: { window } })

export const listTraces = ({ from, to, status, model, tool, user_id, page, page_size } = {}) =>
  request('/admin/ai/traces', { query: { from, to, status, model, tool, user_id, page, page_size } })

export const getTrace = (id) => request(`/admin/ai/traces/${encodeURIComponent(id)}`)

// The contract names this field `expectedVersion` (camelCase), unlike the rest of the API.
export const saveReview = (id, { verdict, note, expectedVersion }) =>
  request(`/admin/ai/traces/${encodeURIComponent(id)}/review`, {
    method: 'PUT',
    body: { verdict, note, expectedVersion },
  })

export const deleteTrace = (id) =>
  request(`/admin/ai/traces/${encodeURIComponent(id)}`, { method: 'DELETE', query: { confirm: 'true' } })

export const listEvalRuns = () => request('/admin/evals')
export const getEvalRun = (id) => request(`/admin/evals/${encodeURIComponent(id)}`)
