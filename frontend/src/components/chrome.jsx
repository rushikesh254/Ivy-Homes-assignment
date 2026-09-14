import { NavLink, Link, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Home, Building2, BedDouble, Heart, BarChart3, LogOut } from 'lucide-react'
import { useSession } from '../context/session'

const NAV = [
  { to: '/listings', label: 'Listings', icon: Home },
  { to: '/rentals', label: 'Rentals', icon: BedDouble },
  { to: '/projects', label: 'Projects', icon: Building2 },
  { to: '/saved', label: 'Saved', icon: Heart },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
]

export function TopBar() {
  const { account, signOut } = useSession()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const linkClass = ({ isActive }) =>
    `relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'text-accent-text bg-raised'
        : 'text-ink-2 hover:text-ink hover:bg-raised/50'
    }`

  const activeStyle = ({ isActive }) =>
    `${linkClass({ isActive })} ${isActive ? 'after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:bg-accent after:rounded-full' : ''}`

  return (
    <header className="sticky top-0 z-50 bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/listings" className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-accent" />
            <span className="font-semibold text-ink text-sm">Ivy Homes</span>
            <span className="hidden sm:inline text-ink-3 text-[10px] font-data">· Pune · RE Intelligence</span>
          </Link>

          <nav className="hidden md:flex items-center gap-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={activeStyle}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline font-data text-[11px] text-ink-3 truncate max-w-[140px]">
              {account?.email}
            </span>
            <button
              onClick={handleSignOut}
              className="p-2 rounded-lg text-ink-3 hover:text-danger hover:bg-raised transition-colors"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <nav className="flex md:hidden gap-1 pb-2 overflow-x-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-accent-text bg-raised' : 'text-ink-3 hover:text-ink hover:bg-raised/50'
                }`
              }
            >
              <Icon className="w-3 h-3" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}

export function AuthGuard({ children }) {
  const { account, restoring } = useSession()
  const location = useLocation()
  if (restoring) return <div className="min-h-screen bg-surface" />
  if (!account) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

export function Shell({ children }) {
  return (
    <div className="min-h-screen bg-surface">
      <TopBar />
      <main>{children}</main>
    </div>
  )
}