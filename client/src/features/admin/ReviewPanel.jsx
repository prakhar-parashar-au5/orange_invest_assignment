import { useEffect, useState } from 'react'
import { saveReview } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatTimestamp } from '@/lib/dates'

const VERDICTS = [
  ['good', 'Good'],
  ['bad', 'Bad'],
  ['needs_fix', 'Needs fix'],
]
const MAX_NOTE = 2000

/**
 * Optimistic locking: we send the `version` we last saw as `expectedVersion` (0 = no review yet).
 * On 409 STALE_REVIEW someone else saved first: we say so, reload the trace (which brings the
 * newer review into the form), and the admin can save again against the new version.
 */
export function ReviewPanel({ traceId, review, onSaved, onReload }) {
  const [verdict, setVerdict] = useState(review?.verdict ?? '')
  const [note, setNote] = useState(review?.note ?? '')
  const [state, setState] = useState({ status: 'idle', message: null }) // idle | saving | saved | stale | error

  // When the review changes underneath us (a reload after 409), show the latest one.
  useEffect(() => {
    setVerdict(review?.verdict ?? '')
    setNote(review?.note ?? '')
  }, [review?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e) {
    e.preventDefault()
    setState({ status: 'saving', message: null })
    try {
      const { review: saved } = await saveReview(traceId, { verdict, note, expectedVersion: review?.version ?? 0 })
      onSaved(saved)
      setState({ status: 'saved', message: null })
    } catch (err) {
      if (err.code === 'STALE_REVIEW') {
        setState({ status: 'stale', message: null })
        await onReload()
      } else {
        setState({ status: 'error', message: err.message })
      }
    }
  }

  return (
    <Card data-testid="review-panel">
      <CardHeader>
        <CardTitle>Review</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-3">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Verdict</legend>
            <div className="flex flex-wrap gap-3">
              {VERDICTS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="verdict"
                    value={value}
                    checked={verdict === value}
                    onChange={() => setVerdict(value)}
                    data-testid={`verdict-${value}`}
                    className="accent-[var(--primary)]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-1">
            <Label htmlFor="review-note">Note</Label>
            <textarea
              id="review-note"
              rows={3}
              value={note}
              maxLength={MAX_NOTE}
              onChange={(e) => setNote(e.target.value)}
              data-testid="review-note"
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            />
          </div>

          {state.status === 'stale' && (
            <Alert data-testid="review-stale">
              <AlertDescription>
                Someone else changed this review while you were editing. The latest version is loaded below; check it and
                save again.
              </AlertDescription>
            </Alert>
          )}
          {state.status === 'error' && (
            <Alert variant="destructive">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!verdict || state.status === 'saving'} data-testid="review-save">
              {state.status === 'saving' ? 'Saving…' : 'Save review'}
            </Button>
            {state.status === 'saved' && <span className="text-sm text-credit">Saved.</span>}
            {review && (
              <span className="text-xs text-muted-foreground">
                v{review.version} · reviewer #{review.reviewer_id} · {formatTimestamp(review.updated_at)}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
