'use client';

import { useCallback, useState } from 'react';

import { useStatsContext } from '@/hooks/stats-context';
import { useEmails } from '@/hooks/useEmails';
import { EmailList } from './EmailList';
import { SearchBar } from './SearchBar';
import type { EmailRowVariant } from './EmailListRow';

/**
 * The whole main pane for one view.
 *
 * /scheduled and /sent differ by exactly two things — which hook they call and
 * which row variant they render — so they share this component rather than
 * duplicating the search/pagination/refresh wiring twice and letting the two
 * copies drift.
 */
export function EmailView({ variant }: { variant: EmailRowVariant }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { refetch: refetchStats } = useStatsContext();

  // One hook, given the view as a value. Calling useScheduledEmails() and
  // useSentEmails() side by side and picking one would fire two requests per
  // render, because hooks cannot be called conditionally.
  const active = useEmails(variant, { page, search });

  // A new query invalidates the current page number: staying on page 3 while
  // the filtered result only has one page shows an empty list that reads as
  // "no matches" when there are plenty. Done in the setter rather than an
  // effect on `search`, so there is no render where the new query is paired
  // with the old page.
  const handleSearchChange = useCallback((next: string) => {
    setSearch(next);
    setPage(1);
  }, []);

  const handleRefresh = useCallback(() => {
    active.refetch();
    // The sidebar badges are derived from the same data; refreshing one
    // without the other is how the counts start lying.
    refetchStats();
  }, [active, refetchStats]);

  return (
    <>
      <SearchBar
        onSearchChange={handleSearchChange}
        onRefresh={handleRefresh}
        refreshing={active.loading}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmailList
          result={active.data}
          loading={active.loading}
          error={active.error}
          variant={variant}
          search={search}
          onRetry={handleRefresh}
          onClearSearch={() => handleSearchChange('')}
          onPageChange={setPage}
        />
      </div>
    </>
  );
}
