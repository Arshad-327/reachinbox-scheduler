'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { ChevronDownIcon, LogoutIcon } from '@/components/ui/icons';

/**
 * The sidebar identity block: avatar, name, email, chevron — and a dropdown
 * holding Logout.
 *
 * Hand-rolled rather than pulled from a menu library because it is one menu
 * with one item; what it does need is the behaviour people expect from a
 * dropdown, which is what the two effects below provide (outside click and
 * Escape both close it).
 */
export function UserCard() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const user = session?.user;

  // Until the session resolves there is no name, email or avatar to show. A
  // skeleton is honest about that; "?" over an em dash just looks broken.
  if (status === 'loading') {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-xl bg-surface-muted px-2.5 py-2">
        <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-full" />
        <span className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-2 w-32" />
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="user-card-trigger"
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
          'bg-surface-muted hover:bg-surface-muted-hover',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green',
        )}
      >
        <Avatar
          src={user?.avatarUrl}
          name={user?.name}
          email={user?.email}
          size={30}
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
            {user?.name ?? '—'}
          </span>
          <span className="block truncate text-[11px] leading-tight text-text-secondary">
            {user?.email ?? ''}
          </span>
        </span>

        <ChevronDownIcon
          className={cn(
            'h-4 w-4 shrink-0 text-text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-border-subtle bg-white py-1 shadow-[0_4px_16px_-4px_rgba(16,24,40,0.14)]"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="logout-button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              // callbackUrl matters: without it NextAuth returns to the current
              // page, which the proxy then bounces to /login anyway — an extra
              // redirect the user can see.
              void signOut({ callbackUrl: '/login' });
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60"
          >
            {signingOut ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <LogoutIcon className="h-4 w-4 text-text-secondary" />
            )}
            {signingOut ? 'Signing out…' : 'Logout'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
