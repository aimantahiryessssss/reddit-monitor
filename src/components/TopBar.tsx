'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { LogOut, LogIn } from 'lucide-react';
import DesktopAlerts from './DesktopAlerts';

export default function TopBar() {
  const { data: session, status } = useSession();
  const isAuthed = status === 'authenticated' && !!session?.user?.id;
  const initials =
    session?.user?.name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/dashboard" className="brand-mark">
          <div className="brand-mark-icon">RM</div>
          <div className="brand-mark-name">Redman ✦</div>
        </Link>
        <div className="topbar-user">
          {isAuthed && <DesktopAlerts />}
          {isAuthed ? (
            <>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--grape) 0%, var(--hot) 100%)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 800,
                  fontFamily: 'Bricolage Grotesque, Space Grotesk, sans-serif',
                  border: '1.5px solid var(--ink)',
                }}
              >
                {initials}
              </div>
              <span className="topbar-user-name">{session?.user?.name ?? session?.user?.email ?? 'Account'}</span>
              <button
                className="topbar-logout"
                onClick={() => signOut({ callbackUrl: '/login' })}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={14} />
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="btn btn-sm btn-primary"
                style={{ textDecoration: 'none' }}
              >
                <LogIn size={14} strokeWidth={2.5} /> Sign in
              </Link>
              <Link
                href="/register"
                className="btn btn-sm"
                style={{ textDecoration: 'none', background: 'transparent', color: 'var(--text-secondary)' }}
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
