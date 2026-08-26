'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiError, useApi } from '@/lib/api-client';
import type { SystemLimits } from '@/types/api';

export interface SystemLimitsResult {
  limits: SystemLimits | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * GET /api/system/limits — the active sender list plus the configured caps.
 *
 * Compose reads it for two things: the From dropdown's contents, and the
 * effective minimum delay, which the worker enforces regardless of what the
 * user types (MIN_DELAY_BETWEEN_EMAILS_MS). Showing the real number beats
 * hardcoding a guess that drifts the first time the env changes.
 */
export function useSystemLimits(): SystemLimitsResult {
  const api = useApi();

  const [limits, setLimits] = useState<SystemLimits | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [settled, setSettled] = useState(false);

  const latestRequest = useRef(0);

  useEffect(() => {
    if (!api.ready) return;

    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    api
      .get<SystemLimits>('/api/system/limits', { signal: controller.signal })
      .then((result) => {
        if (requestId !== latestRequest.current) return;
        setLimits(result);
        setError(null);
        setSettled(true);
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequest.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err : null);
        setSettled(true);
      });

    return () => controller.abort();
  }, [api]);

  return { limits, loading: !settled, error };
}
