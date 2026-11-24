import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const tab = ({ isActive }) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
  )

export function AdminShell() {
  return (
    <div className="grid gap-6">
      <nav className="flex flex-wrap gap-1 border-b pb-3" aria-label="Admin">
        <NavLink to="/admin/ai" end className={tab} data-testid="admin-tab-overview">
          AI overview
        </NavLink>
        <NavLink to="/admin/ai/traces" className={tab} data-testid="admin-tab-traces">
          Traces
        </NavLink>
        <NavLink to="/admin/evals" className={tab} data-testid="admin-tab-evals">
          Evals
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
