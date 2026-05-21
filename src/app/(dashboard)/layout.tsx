'use client';

import { SessionProvider } from 'next-auth/react';
import TopBar from '@/components/TopBar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="app-shell">
        <TopBar />
        <main>{children}</main>
      </div>
    </SessionProvider>
  );
}
