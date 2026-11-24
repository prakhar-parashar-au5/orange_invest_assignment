import { formatTimestamp } from '@/lib/dates'

// Plain SVG bar chart of summary.series: one bar per bucket (all turns), failed turns overlaid in red.
export function SeriesChart({ series }) {
  if (!series?.length) return null
  const max = Math.max(1, ...series.map((b) => b.traces))
  const W = 10
  const H = 60
  return (
    <figure data-testid="summary-chart" className="grid gap-1">
      <svg
        viewBox={`0 0 ${series.length * W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label="Turns per time bucket, failed turns in red"
      >
        {series.map((b, i) => {
          const h = (b.traces / max) * (H - 2)
          const fh = (b.failed / max) * (H - 2)
          return (
            <g key={b.bucket_start}>
              <title>{`${formatTimestamp(b.bucket_start)}: ${b.traces} turns, ${b.failed} failed`}</title>
              <rect x={i * W + 1} y={H - h} width={W - 2} height={h} className="fill-primary/70" />
              {b.failed > 0 && <rect x={i * W + 1} y={H - fh} width={W - 2} height={fh} className="fill-destructive" />}
              {b.traces === 0 && <rect x={i * W + 1} y={H - 1} width={W - 2} height={1} className="fill-border" />}
            </g>
          )
        })}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>{formatTimestamp(series[0].bucket_start)}</span>
        <span>{formatTimestamp(series[series.length - 1].bucket_start)}</span>
      </figcaption>
    </figure>
  )
}
