import { useEffect, useState } from 'react'
import { getHealth } from '@/api/client'
import { cn } from '@/lib/utils'

// "API: ok" / "API: unreachable" from GET /api/health. Checked once on mount.
export function ApiStatus({ className }) {
  const [state, setState] = useState('checking')

  useEffect(() => {
    let alive = true
    getHealth()
      .then((b) => alive && setState(b?.status === 'ok' ? 'ok' : 'unreachable'))
      .catch(() => alive && setState('unreachable'))
    return () => {
      alive = false
    }
  }, [])

  const text = state === 'checking' ? 'API: checking…' : `API: ${state}`
  return (
    <span
      data-testid="api-status"
      className={cn(
        'inline-flex items-center gap-1.5 text-muted-foreground',
        state === 'unreachable' && 'text-destructive',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full bg-muted-foreground/40',
          state === 'ok' && 'bg-credit',
          state === 'unreachable' && 'bg-destructive',
        )}
      />
      {text}
    </span>
  )
}
