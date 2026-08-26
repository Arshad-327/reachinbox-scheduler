'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, useApi } from '@/lib/api-client';
import type { EmailJobDTO, PaginatedResponse } from '@/types/api';

export interface EmailQuery {
  page?: number;
  search?: string;
  limit?: number;
}

export interface EmailsResult {
  data: PaginatedResponse<EmailJobDTO> | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
  /**
   * True only until the first load settles. Lets the list show skeletons on
   * arrival but keep the existing rows on screen while a search refetches, so
   * typing does not blank the page on every keystroke.
   */
  initialLoading: boolean;
}

const DEFAULT_LIMIT = 25;

/** The two list views the backend serves, and the route each one reads. */
export type EmailView = 'scheduled' | 'sent';

const VIEW_PATH: Record<EmailView, string> = {
  scheduled: '/api/emails/scheduled',
  sent: '/api/emails/sent',
};

/**
 * The generic form. Takes the view as a value so a component can switch
 * between them without calling both hooks and firing two requests per render
 * — which is exactly what a `useScheduledEmails(...)` plus `useSentEmails(...)`
 * pair would do, since hooks cannot be called conditionally.
 */
export function useEmails(view: EmailView, query: EmailQuery): EmailsResult {
  return useEmailList(VIEW_PATH[view], query);
}

interface FetchState {
  /** Which query the data below belongs to. null means nothing has loaded. */
  key: string | null;
  data: PaginatedResponse<EmailJobDTO> | null;
  error: ApiError | null;
}

const EMPTY_STATE: FetchState = { key: null, data: null, error: null };

/**
 * Fetches one page of email jobs.
 *
 * Two things here are deliberate and worth reading before changing:
 *
 * 1. RACE CONDITIONS are handled twice over, because there are two distinct
 *    failure modes. An AbortController cancels the in-flight HTTP request when
 *    the query changes, which stops the network work. A monotonic request
 *    counter then guards setState, because aborting is not instantaneous — a
 *    response already parsed and sitting in the microtask queue still resolves
 *    after the abort fires. Without the counter, a slow "a" landing after a
 *    fast "abc" repaints the list with rows for the wrong query. Only the
 *    newest request id may write state.
 *
 * 2. `loading` is DERIVED, not stored: it is simply "the state I hold does not
 *    belong to the query I was asked for". Storing it would mean calling
 *    setState synchronously inside the effect to raise the flag, cascading an
 *    extra render on every query change — which is what React's
 *    set-state-in-effect rule exists to catch.
 */
function useEmailList(
  path: string,
  { page = 1, search = '', limit = DEFAULT_LIMIT }: EmailQuery,
): EmailsResult {
  const api = useApi();

  const trimmedSearch = search.trim();
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<FetchState>(EMPTY_STATE);

  const queryKey = `${path}|${page}|${limit}|${trimmedSearch}|${reloadToken}`;

  // Survives re-renders; incremented per request so late responses can be
  // identified and dropped.
  const latestRequest = useRef(0);

  useEffect(() => {
    // The session is still resolving; firing now would just 401.
    if (!api.ready) return;

    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    api
      .get<PaginatedResponse<EmailJobDTO>>(path, {
        query: { page, limit, search: trimmedSearch || undefined },
        signal: controller.signal,
      })
      .then((result) => {
        if (requestId !== latestRequest.current) return; // stale — discard
        setState({ key: queryKey, data: result, error: null });
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequest.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;

        setState({
          key: queryKey,
          data: null,
          error:
            err instanceof ApiError
              ? err
              : new ApiError({ status: 0, code: 'UNKNOWN', message: String(err), path }),
        });
      });

    return () => controller.abort();
  }, [api, path, page, limit, trimmedSearch, queryKey]);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  const loading = state.key !== queryKey;

  return {
    data: state.data,
    loading,
    error: state.error,
    refetch,
    initialLoading: loading && state.key === null,
  };
}

/** SCHEDULED / QUEUED / PROCESSING, soonest first. */
export function useScheduledEmails(query: EmailQuery): EmailsResult {
  return useEmails('scheduled', query);
}

/** SENT / FAILED, most recent first. */
export function useSentEmails(query: EmailQuery): EmailsResult {
  return useEmails('sent', query);
}
