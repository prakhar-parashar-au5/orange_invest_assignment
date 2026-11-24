import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAiSummary } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRequest } from '@/lib/useRequest'
import { formatTimestamp } from '@/lib/dates'
import { AdminError } from './AdminError'
import { SeriesChart } from './SeriesChart'
import { formatInt, formatMs, formatPercent, formatUsd, tracesHref } from './format'

const WINDOWS = ['24h', '7d', '30d']
const STATUS_LABEL = { SUCCEEDED: 'Succeeded', FAILED: 'Failed', IN_PROGRESS: 'In progress' }

function Stat({ label, children, testId }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm" data-testid={testId}>
          {children}
        </div>
      </CardContent>
    </Card>
  )
}

function CountLink({ to, label, value }) {
  return (
    <Link to={to} className="flex items-baseline justify-between gap-3 rounded px-1 hover:bg-muted">
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{formatInt(value)}</span>
    </Link>
  )
}

export function AiOverviewPage() {
  const [win, setWin] = useState('24h')
  const req = useRequest(() => getAiSummary(win), [win])
  const s = req.data

  // Trace-list date filters are IST calendar dates; the summary window is rolling, so links cover
  // the whole first and last day of the window.
  const range = s ? { from: s.from.slice(0, 10), to: s.to.slice(0, 10) } : {}
  const finished = s ? s.traces.by_status.SUCCEEDED + s.traces.by_status.FAILED : 0

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">AI overview</h1>
        <div className="flex gap-1" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === win ? 'default' : 'outline'}
              aria-pressed={w === win}
              onClick={() => setWin(w)}
              data-testid={`window-${w}`}
            >
              {w}
            </Button>
          ))}
        </div>
      </div>

      {req.status === 'error' && <AdminError error={req.error} onRetry={req.reload} />}
      {req.status === 'loading' && !s && <p className="text-sm text-muted-foreground">Loading…</p>}

      {s && req.status !== 'error' && (
        <>
          <p className="text-xs text-muted-foreground">
            {formatTimestamp(s.from)} → {formatTimestamp(s.to)} (IST)
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Turns by status" testId="summary-status">
              <div className="grid gap-0.5">
                <CountLink to={tracesHref(range)} label="Total" value={s.traces.total} />
                {Object.keys(STATUS_LABEL).map((k) => (
                  <CountLink
                    key={k}
                    to={tracesHref({ ...range, status: k })}
                    label={STATUS_LABEL[k]}
                    value={s.traces.by_status[k] ?? 0}
                  />
                ))}
              </div>
            </Stat>
            <Stat label="Failure rate (of finished turns)" testId="summary-failure-rate">
              <Link to={tracesHref({ ...range, status: 'FAILED' })} className="text-lg font-semibold hover:underline">
                {finished ? formatPercent(s.traces.by_status.FAILED / finished) : '—'}
              </Link>
              {Object.keys(s.traces.failures_by_stage).length > 0 && (
                <ul className="mt-1 text-xs text-muted-foreground">
                  {Object.entries(s.traces.failures_by_stage).map(([stage, n]) => (
                    <li key={stage}>
                      {stage}: {formatInt(n)}
                    </li>
                  ))}
                </ul>
              )}
            </Stat>
            <Stat label="Latency (finished turns)" testId="summary-latency">
              <div className="grid gap-0.5 tabular-nums">
                <span>p50 {formatMs(s.latency_ms.p50)}</span>
                <span>p95 {formatMs(s.latency_ms.p95)}</span>
                <span className="text-xs text-muted-foreground">max {formatMs(s.latency_ms.max)}</span>
              </div>
            </Stat>
            <Stat label="Tokens" testId="summary-tokens">
              <div className="grid gap-0.5 tabular-nums">
                <span>{formatInt(s.tokens.in)} in</span>
                <span>{formatInt(s.tokens.out)} out</span>
              </div>
            </Stat>
            <Stat label="Estimated cost (USD, from the server's price table)" testId="summary-cost">
              <span className="text-lg font-semibold tabular-nums">{formatUsd(s.estimated_cost_usd)}</span>
            </Stat>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Turns over time</CardTitle>
            </CardHeader>
            <CardContent>
              <SeriesChart series={s.series} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Tools</CardTitle>
              </CardHeader>
              <CardContent>
                {s.tools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tool calls in this window.</p>
                ) : (
                  <Table data-testid="summary-tools">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tool</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Failed</TableHead>
                        <TableHead className="text-right">Rejected args</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.tools.map((t) => (
                        <TableRow key={t.name}>
                          <TableCell>
                            <Link to={tracesHref({ ...range, tool: t.name })} className="text-primary hover:underline">
                              {t.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(t.calls)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(t.failed)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInt(t.rejected)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reviews</CardTitle>
              </CardHeader>
              <CardContent>
                {/* The trace list has no review filter in the contract, so these aren't links. */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="summary-reviews">
                  {[
                    ['Good', s.reviews.good],
                    ['Bad', s.reviews.bad],
                    ['Needs fix', s.reviews.needs_fix],
                    ['Unreviewed', s.reviews.unreviewed],
                  ].map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-right font-semibold tabular-nums">{formatInt(v)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
