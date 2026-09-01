import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, DoorOpen, ScrollText, LogOut, Gamepad2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/rooms', label: 'Rooms', icon: DoorOpen },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText },
];

export default function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-60 shrink-0 border-r border-surface-border bg-surface-raised flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-surface-border">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <Gamepad2 size={18} className="text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Roomie</span>
          <span className="badge bg-accent-muted text-accent ml-auto">Admin</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-muted text-accent'
                    : 'text-textsecondary hover:text-textprimary hover:bg-surface-overlay'
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-surface-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center text-accent font-semibold text-sm">
              {user?.displayName?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{user?.displayName || user?.username}</div>
              <div className="text-xs text-textsecondary truncate">@{user?.username}</div>
            </div>
            <button
              onClick={logout}
              className="text-textsecondary hover:text-danger transition-colors"
              title="Log out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
