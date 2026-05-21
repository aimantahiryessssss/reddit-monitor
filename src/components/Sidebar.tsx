'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { LayoutDashboard, Search, BarChart3, Settings, LogOut } from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/keywords', icon: Search, label: 'Keywords' },
  { href: '/brand-insights', icon: BarChart3, label: 'Brand Insights' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const initials =
    session?.user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">RM</div>
        <div className="sidebar-logo-text">Redman</div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-item ${active ? 'active' : ''}`}>
              <Icon size={16} strokeWidth={2} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="user-chip">
          <div className="avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name">{session?.user?.name || 'User'}</div>
            <div className="user-email">{session?.user?.email || ''}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="logout-btn"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
