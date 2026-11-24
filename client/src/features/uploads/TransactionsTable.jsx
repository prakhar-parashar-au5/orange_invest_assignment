import { useEffect, useState } from 'react'
import { getUploadTransactions } from '@/api/endpoints'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatPaise } from '@/lib/money'
import { formatTxnDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

export function TransactionsTable({ uploadId, spendFlags = {} }) {
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, status: 'loading', error: null }))
    getUploadTransactions(uploadId, { page, page_size: PAGE_SIZE })
      .then((data) => alive && setState({ status: 'ready', data, error: null }))
      .catch((error) => alive && setState({ status: 'error', data: null, error }))
    return () => {
      alive = false
    }
  }, [uploadId, page])

  const data = state.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transactions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {state.status === 'error' && (
          <Alert variant="destructive" data-testid="txn-error">
            <AlertDescription>
              {state.error.code === 'NOT_FOUND' ? 'Upload not found.' : state.error.message}
            </AlertDescription>
          </Alert>
        )}

        {state.status === 'loading' && !data && <p className="text-sm text-muted-foreground">Loading…</p>}

        {data && data.total === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="txn-empty">
            This upload added no new transactions. Its rows were duplicates or were rejected.
          </p>
        )}

        {data && data.total > 0 && (
          <>
            <Table data-testid="txn-table" className={cn(state.status === 'loading' && 'opacity-60')}>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transactions.map((t) => {
                  const credit = t.direction === 'credit'
                  const notSpend = !credit && spendFlags[t.category] === false
                  return (
                    <TableRow key={t.id} data-testid="txn-row" data-direction={t.direction}>
                      <TableCell className="tabular-nums">{formatTxnDate(t.txn_date)}</TableCell>
                      <TableCell className="max-w-64 truncate" title={t.description}>
                        {t.merchant ?? <span className="text-muted-foreground">{t.description}</span>}
                      </TableCell>
                      <TableCell>
                        {t.category}
                        {notSpend && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            not spend
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        data-testid="txn-amount"
                        className={cn('text-right font-medium tabular-nums', credit && 'text-credit')}
                      >
                        <span className="sr-only">{credit ? 'Credit ' : 'Debit '}</span>
                        {credit ? '+' : '−'}
                        {formatPaise(t.amount_paise)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between gap-2 text-sm">
              <span data-testid="txn-page-info" className="text-muted-foreground">
                Page {data.page} of {totalPages} · {data.total} transactions
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page <= 1 || state.status === 'loading'}
                  data-testid="txn-prev"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages || state.status === 'loading'}
                  data-testid="txn-next"
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
