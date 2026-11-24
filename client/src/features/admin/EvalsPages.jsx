import { Fragment } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getEvalRun, listEvalRuns } from '@/api/admin'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRequest } from '@/lib/useRequest'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { AdminError } from './AdminError'
import { StatusBadge } from './StatusBadge'
import { formatMs } from './format'

export function EvalRunsPage() {
  const req = useRequest(() => listEvalRuns(), [])
  const runs = req.data?.runs

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Eval runs</h1>
      {req.status === 'error' && <AdminError error={req.error} onRetry={req.reload} />}
      {req.status === 'loading' && !runs && <p className="text-sm text-muted-foreground">Loading…</p>}
      {runs && runs.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="evals-empty">
          No eval runs yet. Runs are created on the server with <code>npm run eval</code>.
        </p>
      )}
      {runs && runs.length > 0 && (
        <Card className="py-2">
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pass / fail / blocked</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id} data-testid="eval-run-row">
                    <TableCell>
                      <Link to={`/admin/evals/${r.id}`} className="text-primary hover:underline">
                        #{r.id} {r.label || 'untitled'}
                      </Link>
                    </TableCell>
                    <TableCell>{r.model}</TableCell>
                    <TableCell>{r.prompt_version}</TableCell>
                    <TableCell>
                      <StatusBadge value={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.cases_passed} / {r.cases_failed} / {r.cases_blocked}
                      <span className="text-xs text-muted-foreground"> of {r.cases_total}</span>
                    </TableCell>
                    <TableCell>{formatTimestamp(r.started_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Gate({ name, gate }) {
  return (
    <span
      data-testid={gate.pass ? 'gate-pass' : 'gate-fail'}
      title={gate.detail || undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono',
        gate.pass ? 'bg-credit/15 text-credit' : 'bg-destructive/15 text-destructive',
      )}
    >
      <span aria-hidden>{gate.pass ? '✓' : '✗'}</span>
      <span className="sr-only">{gate.pass ? 'passed' : 'failed'}</span>
      {name}
    </span>
  )
}

export function EvalRunPage() {
  const { runId } = useParams()
  const req = useRequest(() => getEvalRun(runId), [runId])

  if (req.status === 'error') return <AdminError error={req.error} onRetry={req.reload} notFound="Eval run not found." />
  if (!req.data) return <p className="text-sm text-muted-foreground">Loading…</p>
  const { run, cases } = req.data

  return (
    <div className="grid gap-4">
      <div>
        <Link to="/admin/evals" className="text-xs text-muted-foreground hover:underline">
          ← All runs
        </Link>
        <h1 className="text-xl font-semibold">
          Run #{run.id} {run.label} <StatusBadge value={run.status} className="align-middle" />
        </h1>
        <p className="text-xs text-muted-foreground">
          {run.model} · prompt {run.prompt_version} · {formatTimestamp(run.started_at)} →{' '}
          {run.finished_at ? formatTimestamp(run.finished_at) : 'running'} · {run.cases_passed} passed,{' '}
          {run.cases_failed} failed, {run.cases_blocked} blocked of {run.cases_total}
        </p>
      </div>

      {run.status === 'BLOCKED' && (
        <p className="text-sm text-muted-foreground">
          This run stopped before grading: the agent answered AGENT_UNAVAILABLE on the first question.
        </p>
      )}

      {cases.length > 0 && (
        <Card className="py-2">
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead>Attempts passed</TableHead>
                  <TableHead>Attempts: gates, answer, trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.case_id} data-testid="eval-case" className="align-top">
                    <TableCell className="align-top">
                      <div className="font-mono text-xs">{c.case_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.risk} risk · {c.persona}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={c.verdict} />
                    </TableCell>
                    <TableCell className="align-top tabular-nums">
                      {c.passed_attempts}/{c.attempts}
                      {c.attempts > 1 && ` (${Math.round(c.pass_rate * 100)}%)`}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <ol className="grid gap-2">
                        {c.results.map((r) => (
                          <li key={r.attempt} className="grid gap-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium">Attempt {r.attempt}</span>
                              <StatusBadge value={r.verdict} />
                              <span className="text-muted-foreground">{formatMs(r.latency_ms)}</span>
                              {r.trace_id ? (
                                <Link to={`/admin/ai/traces/${r.trace_id}`} className="text-primary hover:underline">
                                  Trace {r.trace_id}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">no trace</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(r.gates).map(([name, gate]) => (
                                <Fragment key={name}>
                                  <Gate name={name} gate={gate} />
                                </Fragment>
                              ))}
                            </div>
                            {r.answer_text && (
                              <p className="max-w-prose text-xs text-muted-foreground line-clamp-3" title={r.answer_text}>
                                {r.answer_text}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
