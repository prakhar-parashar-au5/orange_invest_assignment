import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { repoUrl } from '@/lib/repoLinks'
import { StatusBadge } from '@/features/admin/StatusBadge'

// Panels built from an artifact's `data` (the generated JSON behind the page). Every field is read
// defensively: a missing file comes back as null, and the page still renders its markdown.

const fmt = (n) => (n === null || n === undefined ? '—' : String(n))

function Generated({ meta }) {
  if (!meta?.generated_at) return null
  return (
    <CardDescription>
      Generated {meta.generated_at}
      {meta.command && (
        <>
          {' '}
          by <code className="font-mono">{meta.command}</code>
        </>
      )}
    </CardDescription>
  )
}

export function SchemaPanel({ schema }) {
  if (!schema?.tables?.length) return null
  return (
    <Card data-testid="schema-panel">
      <CardHeader>
        <CardTitle>Database tables</CardTitle>
        <Generated meta={schema} />
      </CardHeader>
      <CardContent className="grid gap-1">
        {schema.tables.map((t) => {
          const fk = Object.fromEntries((t.foreign_keys || []).map((f) => [f.column, f.references]))
          return (
            <details key={t.name} className="rounded-md border px-3 py-2">
              <summary className="cursor-pointer select-none text-sm">
                <span className="font-mono font-medium">{t.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{t.columns.length} columns</span>
              </summary>
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Null</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>FK</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.columns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono">{c.name}</TableCell>
                      <TableCell className="font-mono text-xs">{c.type}</TableCell>
                      <TableCell>{c.nullable ? 'yes' : 'no'}</TableCell>
                      <TableCell>{c.key || ''}</TableCell>
                      <TableCell className="font-mono text-xs">{fk[c.name] || ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {t.indexes?.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Indexes:{' '}
                  {t.indexes.map((i) => `${i.name}${i.unique ? ' (unique)' : ''} (${i.columns.join(', ')})`).join('; ')}
                </p>
              )}
            </details>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function RequestFlowPanel({ flow }) {
  if (!flow?.steps?.length) return null
  return (
    <Card data-testid="flow-panel">
      <CardHeader>
        <CardTitle>{flow.title || 'Request flow'}</CardTitle>
        {(flow.tables_read?.length > 0 || flow.tables_written?.length > 0) && (
          <CardDescription>
            Reads {flow.tables_read?.join(', ') || '—'} · writes {flow.tables_written?.join(', ') || '—'}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {flow.steps.map((s, i) => {
            const href = s.file ? repoUrl(s.file) : null
            return (
              <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
                <span
                  aria-hidden
                  className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <div className="grid gap-0.5 text-sm">
                  <span>{s.label}</span>
                  <span className="text-xs text-muted-foreground break-all">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">
                        {s.file}
                      </a>
                    ) : (
                      <span className="font-mono">{s.file}</span>
                    )}
                    {s.symbol && (
                      <>
                        {' · '}
                        <code className="font-mono">{s.symbol}</code>
                      </>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

export function QualityPanels({ quality }) {
  if (!quality) return null
  const layers = quality.tests?.layers || []
  const perf = quality.performance?.results || []
  const evals = quality.evals || []
  return (
    <div className="grid gap-4">
      {layers.length > 0 && (
        <Card data-testid="quality-layers">
          <CardHeader>
            <CardTitle>Test layers</CardTitle>
            <Generated meta={quality} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Layer</TableHead>
                  <TableHead>Command</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Tests</TableHead>
                  <TableHead className="text-right">Passed</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {layers.map((l) => (
                  <TableRow key={l.layer}>
                    <TableCell>{l.layer}</TableCell>
                    <TableCell className="font-mono text-xs">{l.command}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.files)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.tests)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.passed)}</TableCell>
                    <TableCell className={l.failed ? 'text-right tabular-nums text-destructive' : 'text-right tabular-nums'}>
                      {fmt(l.failed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(l.test_time_ms)} ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {perf.length > 0 && (
        <Card data-testid="quality-performance">
          <CardHeader>
            <CardTitle>Query performance</CardTitle>
            {quality.performance.user_transactions !== undefined && (
              <CardDescription>
                {quality.performance.user_transactions} transactions for the test user, {quality.performance.traces} traces
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Query</TableHead>
                  <TableHead>EXPLAIN (table: type, key, rows)</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">p50 ms</TableHead>
                  <TableHead className="text-right">p95 ms</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perf.map((r) => (
                  <TableRow key={r.query}>
                    <TableCell className="whitespace-normal">{r.query}</TableCell>
                    <TableCell className="whitespace-normal">
                      <ul className="grid gap-0.5 font-mono text-xs">
                        {(r.explain || []).map((e, i) => (
                          <li key={i} className={e.key ? undefined : 'text-destructive'}>
                            {e.table}: {e.type}, {e.key || 'no index'}, {fmt(e.rows)} rows
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.runs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.p50_ms)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.p95_ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {evals.length > 0 && (
        <Card data-testid="quality-evals">
          <CardHeader>
            <CardTitle>Eval runs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Model / prompt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pass / fail / blocked</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evals.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-normal">
                      #{e.id} {e.label}
                    </TableCell>
                    <TableCell>
                      {e.model} · {e.prompt_version}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={e.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(e.cases_passed)} / {fmt(e.cases_failed)} / {fmt(e.cases_blocked)} of {fmt(e.cases_total)}
                    </TableCell>
                    <TableCell>{e.started_at}</TableCell>
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
