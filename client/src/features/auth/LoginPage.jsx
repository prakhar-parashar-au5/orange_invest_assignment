import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ApiStatus } from '@/components/ApiStatus'
import { useAuth } from './AuthProvider'

export function LoginPage() {
  const { status, login, error: bootError } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (status === 'in') return <Navigate to={location.state?.from || '/uploads'} replace />

  async function onSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, code.trim())
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const shownError = error || (bootError ? bootError.message : null)

  return (
    <main className="min-h-svh flex items-center justify-center p-4 bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="text-primary font-semibold tracking-tight">Orange Invest</div>
          <h1 className="text-xl font-semibold">Log in</h1>
          <CardDescription>Use any email. A new email creates a test account. No password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="login-email"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-code">
                Admin code <span className="font-normal text-muted-foreground">(admins only, optional)</span>
              </Label>
              <Input
                id="admin-code"
                type="password"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                data-testid="login-admin-code"
              />
            </div>
            {shownError && (
              <Alert variant="destructive">
                <AlertDescription>{shownError}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting || !email.trim()} data-testid="login-submit">
              {submitting ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
          <div className="mt-4 text-xs">
            <ApiStatus />
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
