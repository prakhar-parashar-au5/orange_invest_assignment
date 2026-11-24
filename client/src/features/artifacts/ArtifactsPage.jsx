import { Link, Navigate, useParams } from 'react-router-dom'
import { getArtifact, listArtifacts } from '@/api/artifacts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useRequest } from '@/lib/useRequest'
import { cn } from '@/lib/utils'
import { ArtifactMarkdown } from './ArtifactMarkdown'
import { QualityPanels, RequestFlowPanel, SchemaPanel } from './DataPanels'

function ErrorBox({ error, onRetry }) {
  return (
    <Alert variant="destructive" data-testid="artifact-error">
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{error.code === 'NOT_FOUND' ? 'Page not found.' : error.message}</span>
        {error.code !== 'NOT_FOUND' && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

function Artifact({ name }) {
  const req = useRequest(() => getArtifact(name), [name])
  if (req.status === 'error') return <ErrorBox error={req.error} onRetry={req.reload} />
  if (!req.data || req.data.name !== name) return <p className="text-sm text-muted-foreground">Loading…</p>
  const { markdown, data } = req.data
  return (
    <div className="grid gap-6">
      <Card>
        <CardContent className="py-2">
          <ArtifactMarkdown markdown={markdown} />
        </CardContent>
      </Card>
      {data?.schema && <SchemaPanel schema={data.schema} />}
      {data?.request_flow && <RequestFlowPanel flow={data.request_flow} />}
      {data?.quality && <QualityPanels quality={data.quality} />}
    </div>
  )
}

export default function ArtifactsPage() {
  const { name } = useParams()
  const list = useRequest(() => listArtifacts(), [])
  const items = list.data?.artifacts

  if (list.status === 'error' && !items) return <ErrorBox error={list.error} onRetry={list.reload} />
  if (!items) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!name && items.length) return <Navigate to={`/artifacts/${items[0].name}`} replace />

  return (
    <div className="grid gap-4">
      <div
        role="tablist"
        aria-label="Artifacts"
        className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 pb-2 [scrollbar-width:thin]"
      >
        {items.map((a) => (
          <Link
            key={a.name}
            to={`/artifacts/${a.name}`}
            role="tab"
            aria-selected={a.name === name}
            data-testid={`artifact-tab-${a.name}`}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap',
              a.name === name ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {a.title}
          </Link>
        ))}
      </div>
      <section role="tabpanel" aria-label={items.find((a) => a.name === name)?.title || name}>
        <Artifact key={name} name={name} />
      </section>
    </div>
  )
}
