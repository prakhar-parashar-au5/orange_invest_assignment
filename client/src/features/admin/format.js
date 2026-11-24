const int = new Intl.NumberFormat('en-IN')

export const formatInt = (n) => (n === null || n === undefined ? '—' : int.format(n))

// 980 → "980 ms", 2841 → "2.84 s"
export function formatMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

// Estimated cost in USD (an estimate from the server's price table, not a bill).
export function formatUsd(usd) {
  if (usd === null || usd === undefined) return '—'
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`
}

export function formatPercent(fraction) {
  if (fraction === null || Number.isNaN(fraction)) return '—'
  return `${(fraction * 100).toFixed(1)}%`
}

// Builds "/admin/ai/traces?status=FAILED&from=…" from a filter object, dropping empty values.
export function tracesHref(filters) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `/admin/ai/traces?${s}` : '/admin/ai/traces'
}
