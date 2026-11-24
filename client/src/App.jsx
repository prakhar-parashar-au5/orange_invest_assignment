import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { LoginPage } from '@/features/auth/LoginPage'
import { AppLayout } from '@/components/AppLayout'
import { UploadsPage } from '@/features/uploads/UploadsPage'
import { ChatPage } from '@/features/chat/ChatPage'
import { AdminShell } from '@/features/admin/AdminShell'
import { AiOverviewPage } from '@/features/admin/AiOverviewPage'
import { TracesPage } from '@/features/admin/TracesPage'
import { TraceDetailPage } from '@/features/admin/TraceDetailPage'
import { EvalRunPage, EvalRunsPage } from '@/features/admin/EvalsPages'

// Artifacts pull in react-markdown (and, on demand, Mermaid), so they load as their own chunk.
const ArtifactsPage = lazy(() => import('@/features/artifacts/ArtifactsPage'))

function FullPageMessage({ children }) {
  return <div className="min-h-svh flex items-center justify-center text-muted-foreground">{children}</div>
}

// Logged-out users only ever see the login screen.
function RequireAuth({ children }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>
  if (status === 'out') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

function LoginRoute() {
  const { status } = useAuth()
  if (status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>
  return <LoginPage />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/uploads/:uploadId?" element={<UploadsPage />} />
          <Route path="/chat/:conversationId?" element={<ChatPage />} />
          <Route
            path="/artifacts/:name?"
            element={
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
                <ArtifactsPage />
              </Suspense>
            }
          />
          {/* Admin routes render for anyone logged in; the backend's 403 decides access. */}
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<Navigate to="/admin/ai" replace />} />
            <Route path="ai" element={<AiOverviewPage />} />
            <Route path="ai/traces" element={<TracesPage />} />
            <Route path="ai/traces/:traceId" element={<TraceDetailPage />} />
            <Route path="evals" element={<EvalRunsPage />} />
            <Route path="evals/:runId" element={<EvalRunPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/uploads" replace />} />
      </Routes>
    </AuthProvider>
  )
}
