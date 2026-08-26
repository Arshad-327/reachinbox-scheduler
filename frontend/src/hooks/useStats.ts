'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, useApi } from '@/lib/api-client';
import type { StatsResponse } from '@/types/api';

export interface StatsResult {
  stats: StatsResponse | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

interface StatsState {
  /** Which reload generation the data belongs to; -1 means nothing yet. */
  token: number;
  stats: StatsResponse | null;
  error: ApiError | null;
}

const EMPTY_STATE: StatsState = { token: -1, stats: null, error: null };

/**
 * The sidebar badge counts.
 *
 * Deliberately not polled: the numbers change when the worker sends something,
 * and a timer here would put a request on the wire every few seconds for a
 * dashboard nobody is looking at. The refresh button and each list refetch
 * call `refetch()` instead, which keeps the counts honest at exactly the
 * moments the user expects them to move.
 *
 * `loading` is derived from the generation counter for the same reason as in
 * useEmails — see the note there.
 */
export function useStats(): StatsResult {
  const api = useApi();

  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<StatsState>(EMPTY_STATE);

  const latestRequest = useRef(0);

  useEffect(() => {
    if (!api.ready) return;

    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    api
      .get<StatsResponse>('/api/emails/stats', { signal: controller.signal })
      .then((result) => {
        if (requestId !== latestRequest.current) return;
        setState({ token: reloadToken, stats: result, error: null });
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequest.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;

        setState({
          token: reloadToken,
          stats: null,
          error: err instanceof ApiError ? err : null,
        });
      });

    return () => controller.abort();
  }, [api, reloadToken]);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  return {
    stats: state.stats,
    loading: state.token !== reloadToken,
    error: state.error,
    refetch,
  };
}
