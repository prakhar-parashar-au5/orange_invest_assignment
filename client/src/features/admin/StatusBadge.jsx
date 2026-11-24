import { cn } from '@/lib/utils'

const TONE = {
  SUCCEEDED: 'bg-credit/15 text-credit',
  FINISHED: 'bg-credit/15 text-credit',
  pass: 'bg-credit/15 text-credit',
  good: 'bg-credit/15 text-credit',
  FAILED: 'bg-destructive/15 text-destructive',
  fail: 'bg-destructive/15 text-destructive',
  bad: 'bg-destructive/15 text-destructive',
  REJECTED: 'bg-accent text-accent-foreground',
  needs_fix: 'bg-accent text-accent-foreground',
  BLOCKED: 'bg-accent text-accent-foreground',
  blocked: 'bg-accent text-accent-foreground',
}

export function StatusBadge({ value, className }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
        TONE[value] || 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {value}
    </span>
  )
}
