import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteTrace, getTrace } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useRequest } from '@/lib/useRequest'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Markdown } from '@/features/chat/Markdown'
import { AdminError } from './AdminError'
import { JsonView } from './JsonView'
import { ReviewPanel } from './ReviewPanel'
import { StatusBadge } from './StatusBadge'
import { formatInt, formatMs } from './format'

function Step({ kind, title, children, tone }) {
  return (
    <li data-testid="timeline-step" data-kind={kind} className="relative pl-6">
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1.5 size-3 rounded-full border-2 bg-background',
          tone === 'bad' ? 'border-destructive' : tone === 'warn' ? 'border-primary' : 'border-muted-foreground/50',
        )}
      />
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 grid gap-1 text-sm">{children}</div>
    </li>
  )
}

function Meta({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {items.filter(Boolean).map((x, i) => (
        <span key={i}>{x}</span>
      ))}
    </div>
  )
}

function Timeline({ data }) {
  const { trace } = data
  return (
    <ol className="grid gap-4 border-l border-border pl-0 ml-1.5" data-testid="timeline">
      <Step kind="user" title="User prompt">
        <p className="whitespace-pre-wrap">{data.user_message?.content ?? '—'}</p>
      </Step>

      {[...data.timeline]
        .sort((a, b) => a.seq - b.seq)
        .map((s) =>
          s.type === 'model_call' ? (
            <Step
              key={s.seq}
              kind="model_call"
              tone={s.status === 'FAILED' ? 'bad' : undefined}
              title={
                <>
                  #{s.seq} Model call · {s.model} <StatusBadge value={s.status} />
                </>
              }
            >
              <Meta
                items={[
                  s.finish_reason ? `finish: ${s.finish_reason}` : 'finish: —',
                  `requested ${s.requested_tools} tool${s.requested_tools === 1 ? '' : 's'}`,
                  `${formatInt(s.tokens_in)} in / ${formatInt(s.tokens_out)} out tokens`,
                  formatMs(s.latency_ms),
                ]}
              />
            </Step>
          ) : (
            <Step
              key={s.seq}
              kind="tool_call"
              tone={s.status === 'FAILED' ? 'bad' : s.status === 'REJECTED' ? 'warn' : undefined}
              title={
                <>
                  #{s.seq} Tool call · <code className="font-mono">{s.name}</code> <StatusBadge value={s.status} />
                </>
              }
            >
              <Meta items={[`round ${s.round}`, `validation: ${s.validation_status}`, formatMs(s.latency_ms)]} />
              {s.error && <p className="text-xs text-destructive">Error: {s.error}</p>}
              <JsonView label="Arguments" value={s.args} />
              <JsonView label="Result" value={s.result} />
            </Step>
          ),
        )}

      {data.assistant_message && (
        <Step kind="answer" title="Final answer">
          <div className="rounded-md bg-muted px-3 py-2">
            <Markdown text={data.assistant_message.content} />
          </div>
        </Step>
      )}

      {trace.status === 'FAILED' && (
        <li className="relative pl-6" data-testid="stopped-here">
          <span aria-hidden className="absolute left-0 top-1.5 size-3 rounded-full bg-destructive" />
          <Alert variant="destructive">
            <AlertDescription>
              <span className="font-semibold">Stopped here.</span> Failed at stage <code>{trace.error_stage ?? '—'}</code>
              {trace.error_class && (
                <>
                  {' '}
                  with <code>{trace.error_class}</code>
                </>
              )}
              {trace.provider_http_status !== null && <>, provider HTTP {trace.provider_http_status}</>}.
            </AlertDescription>
          </Alert>
        </li>
      )}
      {trace.status === 'IN_PROGRESS' && (
        <li className="pl-6 text-sm text-muted-foreground" data-testid="still-running">
          Still running. Reload to see more.
        </li>
      )}
    </ol>
  )
}

function DeleteTrace({ traceId }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function doDelete() {
    setBusy(true)
    setError(null)
    try {
      await deleteTrace(traceId)
      navigate('/admin/ai/traces', { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      {!confirming ? (
        <Button variant="outline" onClick={() => setConfirming(true)} data-testid="trace-delete">
          Delete trace
        </Button>
      ) : (
        <Alert variant="destructive" data-testid="trace-delete-confirm">
          <AlertDescription className="grid gap-2">
            <span>Delete this trace with its model calls, tool calls and review? The chat messages stay. This can't be undone.</span>
            <span className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={doDelete} disabled={busy} data-testid="trace-delete-yes">
                {busy ? 'Deleting…' : 'Yes, delete'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export function TraceDetailPage() {
  const { traceId } = useParams()
  const req = useRequest(() => getTrace(traceId), [traceId])
  const data = req.data

  if (req.status === 'error' && !data) return <AdminError error={req.error} onRetry={req.reload} notFound="Trace not found." />
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>

  const t = data.trace
  const navLink = (id, label, testId) =>
    id ? (
      <Link to={`/admin/ai/traces/${id}`} className="text-sm text-primary hover:underline" data-testid={testId}>
        {label}
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground" aria-disabled="true">
        {label}
      </span>
    )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin/ai/traces" className="text-xs text-muted-foreground hover:underline">
            ← All traces
          </Link>
          <h1 className="text-xl font-semibold">
            Trace #{t.id} <StatusBadge value={t.status} className="align-middle" />
          </h1>
        </div>
        <nav className="flex gap-4" aria-label="Turns in this conversation">
          {navLink(data.prev_trace_id, '← Previous turn', 'trace-prev')}
          {navLink(data.next_trace_id, 'Next turn →', 'trace-next')}
        </nav>
      </div>

      {req.status === 'error' && <AdminError error={req.error} onRetry={req.reload} />}

      <Meta
        items={[
          formatTimestamp(t.created_at),
          `${t.model} · prompt ${t.prompt_version}`,
          `${t.rounds} rounds`,
          `${formatInt(data.tokens.in)} in / ${formatInt(data.tokens.out)} out tokens`,
          `latency ${formatMs(t.latency_ms)}`,
          `${t.user_email} (#${t.user_id})`,
          `conversation #${t.conversation_id}`,
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline data={data} />
          </CardContent>
        </Card>
        <div className="grid gap-4 content-start">
          <ReviewPanel
            traceId={t.id}
            review={data.review}
            onSaved={(review) => req.setData((d) => ({ ...d, review }))}
            onReload={req.reload}
          />
          <DeleteTrace traceId={t.id} />
        </div>
      </div>
    </div>
  )
}
