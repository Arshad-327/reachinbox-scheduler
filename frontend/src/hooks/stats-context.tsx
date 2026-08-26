'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { useStats, type StatsResult } from './useStats';

/**
 * One stats fetch, shared.
 *
 * The sidebar renders the counts and the list pages need to invalidate them
 * (a refresh, or a send completing between page views). Without this, both
 * would call useStats() and there would be two copies of the same numbers that
 * drift apart the moment one refetches and the other doesn't.
 */
const StatsContext = createContext<StatsResult | null>(null);

export function StatsProvider({ children }: { children: ReactNode }) {
  const value = useStats();
  return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>;
}

export function useStatsContext(): StatsResult {
  const ctx = useContext(StatsContext);
  if (!ctx) {
    throw new Error('useStatsContext must be used inside <StatsProvider> (see AppShell)');
  }
  return ctx;
}
