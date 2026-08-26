'use client';

import type { ApiError } from '@/lib/api-client';
import { rangeLabel } from '@/lib/format';
import type { EmailJobDTO, PaginatedResponse } from '@/types/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { AlertIcon, InboxIcon, SearchIcon } from '@/components/ui/icons';
import { EmailListRow, type EmailRowVariant } from './EmailListRow';

/** Five rows, each with a different subject width. */
const SUBJECT_WIDTHS = ['92%', '74%', '86%', '61%', '80%'];

export interface EmailListProps {
  result: PaginatedResponse<EmailJobDTO> | null;
  loading: boolean;
  error: ApiError | null;
  variant: EmailRowVariant;
  /** The active search, so the empty state can say which of the two it is. */
  search: string;
  onRetry: () => void;
  onClearSearch: () => void;
  onPageChange: (page: number) => void;
}

/**
 * Owns the four states a list can be in — loading, error, empty, data — and
 * nothing else. It takes the fetched result as props rather than fetching, so
 * the same component serves both views and can be rendered in isolation.
 */
export function EmailList({
  result,
  loading,
  error,
  variant,
  search,
  onRetry,
  onClearSearch,
  onPageChange,
}: EmailListProps) {
  // Errors win over stale data: showing rows from before the failure next to
  // no indication of it is how people end up acting on numbers that are wrong.
  if (error) {
    return (
      <EmptyState
        icon={<AlertIcon className="h-5 w-5 text-status-red-fg" />}
        title="Could not load emails"
        description={`${error.code}: ${error.message}`}
        action={{ label: 'Try again', onClick: onRetry }}
      />
    );
  }

  if (loading && !result) {
    return (
      <div data-testid="email-list-skeleton" aria-busy="true" aria-label="Loading emails">
        {SUBJECT_WIDTHS.map((width, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-border-hairline px-6 py-3.5"
          >
            <Skeleton className="h-3.5 w-[180px] shrink-0" />
            <Skeleton className="h-5 w-[104px] shrink-0 rounded-full" />
            {/* Varying widths so the block reads as lines of text rather than
                a stack of identical bars. */}
            <span className="min-w-0 flex-1">
              <Skeleton className="h-3.5" style={{ width }} />
            </span>
            <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
          </div>
        ))}
      </div>
    );
  }

  const rows = result?.data ?? [];

  if (rows.length === 0) {
    return search.trim() ? (
      <EmptyState
        icon={<SearchIcon className="h-5 w-5" />}
        title={`No emails match “${search.trim()}”`}
        description="Search looks at the recipient address and the subject line."
        action={{ label: 'Clear search', onClick: onClearSearch }}
      />
    ) : (
      <EmptyState
        icon={<InboxIcon className="h-5 w-5" />}
        title={variant === 'scheduled' ? 'Nothing scheduled' : 'Nothing sent yet'}
        description={
          variant === 'scheduled'
            ? 'Emails you schedule will queue up here, soonest first.'
            : 'Once the worker delivers a scheduled email it moves here, newest first.'
        }
      />
    );
  }

  const { page, limit, total, totalPages } = result!;

  return (
    <>
      <div data-testid="email-list">
        {rows.map((job) => (
          <EmailListRow key={job.id} job={job} variant={variant} />
        ))}
      </div>

      {/* One page of results needs no controls at all. */}
      {totalPages > 1 ? (
        <div
          data-testid="pagination"
          className="flex items-center justify-between px-6 py-4 text-[12px] text-text-secondary"
        >
          <span data-testid="pagination-range">{rangeLabel(page, limit, total)}</span>

          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </>
  );
}
