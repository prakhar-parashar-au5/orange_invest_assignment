import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listTraces } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRequest } from '@/lib/useRequest'
import { formatTimestamp } from '@/lib/dates'
import { AdminError } from './AdminError'
import { StatusBadge } from './StatusBadge'
import { formatInt, formatMs } from './format'

const FILTERS = ['from', 'to', 'status', 'model', 'tool', 'user_id']
const PAGE_SIZE = 50

export function TracesPage() {
  const [params, setParams] = useSearchParams()
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || '']))
  const page = Number(params.get('page') || 1)
  const key = params.toString()

  const req = useRequest(() => listTraces({ ...filters, page, page_size: PAGE_SIZE }), [key])
  const [draft, setDraft] = useState(filters)
  const [draftKey, setDraftKey] = useState(key)
  if (draftKey !== key) {
    // URL changed from outside (a link, back button): show its filters in the form.
    setDraftKey(key)
    setDraft(filters)
  }

  function apply(e) {
    e.preventDefault()
    const next = new URLSearchParams()
    for (const k of FILTERS) if (draft[k]?.trim()) next.set(k, draft[k].trim())
    setParams(next)
  }

  function goTo(p) {
    const next = new URLSearchParams(params)
    next.set('page', String(p))
    setParams(next)
  }

  const field = (k, label, props = {}) => (
    <div className="grid gap-1">
      <Label htmlFor={`f-${k}`}>{label}</Label>
      <Input
        id={`f-${k}`}
        value={draft[k]}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        data-testid={`filter-${k}`}
        {...props}
      />
    </div>
  )

  const data = req.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Traces</h1>

      <Card className="py-4">
        <CardContent className="px-4">
          <form onSubmit={apply} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7 items-end">
            {field('from', 'From (IST date)', { type: 'date' })}
            {field('to', 'To (IST date)', { type: 'date' })}
            <div className="grid gap-1">
              <Label htmlFor="f-status">Status</Label>
              <select
                id="f-status"
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                data-testid="filter-status"
                className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
              >
                <option value="">Any</option>
                <option value="SUCCEEDED">SUCCEEDED</option>
                <option value="FAILED">FAILED</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
              </select>
            </div>
            {field('model', 'Model', { placeholder: 'gpt-4.1-mini' })}
            {field('tool', 'Tool', { placeholder: 'spend_summary' })}
            {field('user_id', 'User ID', { inputMode: 'numeric' })}
            <div className="flex gap-2">
              <Button type="submit" data-testid="filter-apply">
                Apply
              </Button>
              <Button type="button" variant="outline" onClick={() => setParams(new URLSearchParams())}>
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {req.status === 'error' && <AdminError error={req.error} onRetry={req.reload} />}
      {req.status === 'loading' && !data && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && req.status !== 'error' && (
        <Card className="py-2">
          <CardContent className="px-2">
            {data.total === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground" data-testid="traces-empty">
                No traces match these filters.
              </p>
            ) : (
              <Table data-testid="traces-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Tools</TableHead>
                    <TableHead className="text-right">Rounds</TableHead>
                    <TableHead className="text-right">Tokens in / out</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.traces.map((t) => (
                    <TableRow key={t.id} data-testid="trace-row">
                      <TableCell>
                        <Link to={`/admin/ai/traces/${t.id}`} className="text-primary hover:underline">
                          #{t.id} · {formatTimestamp(t.created_at)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={t.status} />
                        {t.status === 'FAILED' && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {t.error_stage}
                            {t.provider_http_status ? ` · ${t.provider_http_status}` : ''}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.model} <span className="text-xs text-muted-foreground">{t.prompt_version}</span>
                      </TableCell>
                      <TableCell className="max-w-56 truncate" title={t.tool_names.join(', ')}>
                        {t.tool_names.length ? t.tool_names.join(', ') : <span className="text-muted-foreground">none</span>}
                        {t.tool_call_count > t.tool_names.length && (
                          <span className="text-xs text-muted-foreground"> ({t.tool_call_count} calls)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.rounds}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatInt(t.tokens_in)} / {formatInt(t.tokens_out)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMs(t.latency_ms)}</TableCell>
                      <TableCell className="max-w-48 truncate">
                        {t.user_email} <span className="text-xs text-muted-foreground">#{t.user_id}</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={t.review_verdict} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {data.total > 0 && (
              <div className="flex items-center justify-between gap-2 px-2 pt-3 text-sm">
                <span className="text-muted-foreground" data-testid="traces-page-info">
                  Page {data.page} of {totalPages} · {formatInt(data.total)} traces
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goTo(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
