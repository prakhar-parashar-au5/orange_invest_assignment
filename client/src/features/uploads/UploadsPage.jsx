import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getCategories, listUploads } from '@/api/endpoints'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { UploadCard } from './UploadCard'
import { UploadList } from './UploadList'
import { TransactionsTable } from './TransactionsTable'

// name → is_spend, from GET /api/categories. Empty until loaded; the table works without it.
function useSpendFlags() {
  const [flags, setFlags] = useState({})
  useEffect(() => {
    let alive = true
    getCategories()
      .then(({ categories }) => alive && setFlags(Object.fromEntries(categories.map((c) => [c.name, c.is_spend]))))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return flags
}

export function UploadsPage() {
  const { uploadId } = useParams()
  const [uploads, setUploads] = useState({ status: 'loading', items: [], error: null })
  const spendFlags = useSpendFlags()

  const load = useCallback(() => {
    setUploads((u) => ({ ...u, status: 'loading', error: null }))
    listUploads()
      .then(({ uploads: items }) => setUploads({ status: 'ready', items, error: null }))
      .catch((error) => setUploads({ status: 'error', items: [], error }))
  }, [])

  useEffect(load, [load])

  const onUploaded = (upload) =>
    setUploads((u) => ({ status: 'ready', items: [upload, ...u.items.filter((x) => x.id !== upload.id)], error: null }))

  return (
    <div className="grid gap-6 md:grid-cols-[320px_minmax(0,1fr)]">
      <div className="grid gap-6 content-start">
        <h1 className="text-xl font-semibold">Uploads</h1>
        <UploadCard onUploaded={onUploaded} />
        <Card>
          <CardHeader>
            <CardTitle>Your uploads</CardTitle>
          </CardHeader>
          <CardContent>
            {uploads.status === 'error' ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {uploads.error.message}{' '}
                  <Button variant="link" className="h-auto p-0" onClick={load}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : uploads.status === 'loading' && uploads.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <UploadList uploads={uploads.items} selectedId={uploadId ? Number(uploadId) : null} />
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-label="Transactions" className="min-w-0">
        {uploadId ? (
          <TransactionsTable key={uploadId} uploadId={uploadId} spendFlags={spendFlags} />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Select an upload to see its transactions.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}
