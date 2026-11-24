import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ApiStatus } from '@/components/ApiStatus'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'

const navClass = ({ isActive }) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
  )

export function AppLayout() {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-6xl flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="text-primary font-semibold tracking-tight">Orange Invest</span>
          <nav className="flex gap-1" aria-label="Main">
            <NavLink to="/uploads" className={navClass} data-testid="nav-uploads">
              Uploads
            </NavLink>
            <NavLink to="/chat" className={navClass} data-testid="nav-chat">
              Chat
            </NavLink>
            <NavLink to="/artifacts" className={navClass} data-testid="nav-artifacts">
              Artifacts
            </NavLink>
            {/* Convenience only. Admin pages still render the backend's 403 for non-admins. */}
            {user?.role === 'admin' && (
              <NavLink to="/admin/ai" className={navClass} data-testid="nav-admin">
                Admin
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ApiStatus className="hidden sm:inline-flex text-xs" />
            <span data-testid="current-user" className="text-muted-foreground truncate max-w-48">
              {user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={logout} data-testid="logout">
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
