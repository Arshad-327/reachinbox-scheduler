'use client';

import type { ReactNode } from 'react';

import { StatsProvider } from '@/hooks/stats-context';
import { Sidebar } from './Sidebar';

/**
 * Sidebar + main pane, full height, white.
 *
 * The StatsProvider wraps both halves so the sidebar counts and a page's
 * refresh button are looking at the same fetch.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <StatsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-white">
        <Sidebar />
        {/* min-w-0 lets the truncating row text shrink instead of forcing the
            flex row wider than the viewport. */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </StatsProvider>
  );
}
