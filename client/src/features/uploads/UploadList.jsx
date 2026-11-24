import { Link } from 'react-router-dom'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'

export function UploadList({ uploads, selectedId }) {
  if (uploads.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="upload-list-empty">
        No uploads yet. Upload a bank-statement CSV to get started.
      </p>
    )
  }
  return (
    <ul className="grid gap-1" data-testid="upload-list">
      {uploads.map((u) => (
        <li key={u.id}>
          <Link
            to={`/uploads/${u.id}`}
            data-testid="upload-item"
            aria-current={u.id === selectedId ? 'page' : undefined}
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              u.id === selectedId && 'bg-accent',
            )}
          >
            <span className="block truncate font-medium">{u.filename}</span>
            <span className="block text-xs text-muted-foreground">
              {formatTimestamp(u.created_at)} · {u.rows_inserted} new, {u.rows_duplicate} duplicate,{' '}
              {u.rows_rejected} rejected
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
