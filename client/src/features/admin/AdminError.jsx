import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

// Renders an ApiError from an admin endpoint. Hiding the nav isn't authorisation: a non-admin who
// opens an admin URL gets the backend's 403, shown here. 401 is handled globally (back to login).
export function AdminError({ error, onRetry, notFound = 'Not found.' }) {
  if (!error) return null
  if (error.code === 'FORBIDDEN') {
    return (
      <Alert variant="destructive" data-testid="admin-forbidden">
        <AlertTitle>Admins only</AlertTitle>
        <AlertDescription>Your account doesn't have admin access to this page.</AlertDescription>
      </Alert>
    )
  }
  const message = error.code === 'NOT_FOUND' ? notFound : error.message
  return (
    <Alert variant="destructive" data-testid="admin-error">
      {error.status === 503 && <AlertTitle>Temporarily unavailable</AlertTitle>}
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{message}</span>
        {onRetry && error.code !== 'NOT_FOUND' && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
