import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { UploadCloud } from 'lucide-react'
import { createUpload } from '@/api/endpoints'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

// Same limit as the server (API-CONTRACT POST /api/uploads). Checked here too so a wrong file
// fails instantly instead of after a 5 MB round trip.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

function checkFile(file) {
  if (!/\.csv$/i.test(file.name)) return 'Only CSV files are supported. Export your statement as .csv.'
  if (file.size > MAX_UPLOAD_BYTES) return 'The file is over 5 MB. Split it into smaller files.'
  return null
}

function Count({ label, value, testId, tone }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className={cn('text-lg font-semibold tabular-nums', tone)} data-testid={testId}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export function UploadCard({ onUploaded }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [state, setState] = useState({ status: 'idle' }) // idle | uploading | done | error

  async function handleFile(file) {
    if (!file) return
    const problem = checkFile(file)
    if (problem) {
      setState({ status: 'error', message: problem })
      return
    }
    setState({ status: 'uploading', filename: file.name })
    try {
      const result = await createUpload(file)
      setState({ status: 'done', ...result })
      onUploaded(result.upload)
    } catch (err) {
      setState({ status: 'error', message: err.message })
    }
  }

  const busy = state.status === 'uploading'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a statement</CardTitle>
        <CardDescription>Bank-statement CSV, up to 5 MB.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div
          data-testid="upload-dropzone"
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!busy) handleFile(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors',
            dragging ? 'border-primary bg-accent' : 'border-input',
            busy && 'opacity-60',
          )}
        >
          <UploadCloud className="size-6 text-primary" aria-hidden />
          <span className="text-muted-foreground">Drop a CSV file here, or</span>
          <label
            htmlFor="upload-file"
            data-testid="upload-choose"
            className={cn(
              'inline-flex h-9 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90',
              'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              busy && 'pointer-events-none',
            )}
          >
            Choose CSV file
            <input
              ref={inputRef}
              id="upload-file"
              data-testid="upload-input"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                handleFile(e.target.files?.[0])
                e.target.value = '' // allow choosing the same file again
              }}
            />
          </label>
        </div>

        {state.status === 'uploading' && (
          <p className="text-sm text-muted-foreground" role="status" data-testid="upload-progress">
            Uploading {state.filename}… this can take a few seconds.
          </p>
        )}

        {state.status === 'error' && (
          <Alert variant="destructive" data-testid="upload-error">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        {state.status === 'done' && (
          <div className="grid gap-3" data-testid="upload-result">
            <p className="text-sm">
              <span className="font-medium">{state.upload.filename}</span>: {state.upload.rows_total} rows read.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Count label="Inserted" value={state.upload.rows_inserted} testId="count-inserted" tone="text-credit" />
              <Count label="Duplicates" value={state.upload.rows_duplicate} testId="count-duplicate" />
              <Count
                label="Rejected"
                value={state.upload.rows_rejected}
                testId="count-rejected"
                tone={state.upload.rows_rejected ? 'text-destructive' : undefined}
              />
            </div>
            {state.rejected_rows?.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Why rows were rejected</summary>
                <ul className="mt-2 grid gap-1" data-testid="rejected-rows">
                  {state.rejected_rows.map((r) => (
                    <li key={r.line}>
                      Line {r.line}: {r.reason}
                    </li>
                  ))}
                </ul>
                {state.upload.rows_rejected > state.rejected_rows.length && (
                  <p className="mt-1 text-xs text-muted-foreground">Showing the first {state.rejected_rows.length}.</p>
                )}
              </details>
            )}
            <Link
              to={`/uploads/${state.upload.id}`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              data-testid="upload-view-transactions"
            >
              View transactions
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
