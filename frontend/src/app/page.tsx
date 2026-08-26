'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { signOut, useSession } from 'next-auth/react';
import { toast } from 'sonner';

import { ApiError, useApi } from '@/lib/api-client';
import type { StatsResponse } from '@/types/api';

/**
 * TEMPORARY. This is the auth smoke test, not the dashboard.
 *
 * It exists to prove the full chain end to end before any real UI is built:
 * Google consent -> backend JWT on the NextAuth session -> an authenticated
 * call to GET /api/emails/stats that comes back 200. If the stats JSON renders,
 * every link in that chain works. The dashboard replaces this file.
 */
export default function Home() {
  const { data: session, status } = useSession();
  const api = useApi();

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    // Gate on `ready` so the first render -- when useSession() is still
    // resolving and there is no token yet -- does not fire a doomed request.
    if (!api.ready) return;

    const controller = new AbortController();

    api
      .get<StatsResponse>('/api/emails/stats', { signal: controller.signal })
      .then((data) => {
        setStats(data);
        setStatsError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;

        const message =
          err instanceof ApiError
            ? `${err.status} ${err.code}: ${err.message}`
            : String(err);

        setStatsError(message);
        toast.error('Could not load stats', { description: message });
      });

    return () => controller.abort();
  }, [api]);

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-page-bg">
        <p className="text-text-secondary">Loading session…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <div className="rounded-2xl border border-border-subtle bg-surface p-7 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <div className="flex items-center gap-4">
          {session?.user?.avatarUrl ? (
            <Image
              src={session.user.avatarUrl}
              alt=""
              width={56}
              height={56}
              className="rounded-full"
              unoptimized
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-text-muted">
              ?
            </div>
          )}

          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{session?.user?.name}</p>
            <p className="truncate text-sm text-text-secondary">{session?.user?.email}</p>
            <p className="truncate font-mono text-xs text-text-muted">
              id: {session?.user?.id}
            </p>
          </div>

          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="ml-auto shrink-0 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-green-hover"
          >
            Logout
          </button>
        </div>

        <hr className="my-6 border-border-subtle" />

        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          GET /api/emails/stats
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          Authenticated with the backend JWT held on the NextAuth session.
        </p>

        {statsError ? (
          <pre className="mt-3 overflow-x-auto rounded-lg border border-danger-border bg-danger-bg p-4 text-xs text-danger">
            {statsError}
          </pre>
        ) : (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-muted p-4 font-mono text-xs leading-relaxed">
            {stats ? JSON.stringify(stats, null, 2) : 'Loading…'}
          </pre>
        )}
      </div>
    </main>
  );
}
