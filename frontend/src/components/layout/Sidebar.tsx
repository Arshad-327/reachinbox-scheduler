'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useStatsContext } from '@/hooks/stats-context';
import { Button } from '@/components/ui/Button';
import { ClockIcon, SendIcon } from '@/components/ui/icons';
import { UserCard } from './UserCard';
import { Wordmark } from './Wordmark';

interface NavItem {
  href: string;
  label: string;
  icon: typeof ClockIcon;
  /** Which field of GET /api/emails/stats this row's badge shows. */
  countKey: 'scheduled' | 'sent';
}

/**
 * The two views the backend actually serves. `countKey` ties each row to the
 * stats field the API returns for it, so the badge cannot drift from the list
 * it labels: /scheduled shows stats.scheduled, /sent shows stats.sent, and
 * both come from the same GET /api/emails/stats the lists are paged from.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/scheduled', label: 'Scheduled', icon: ClockIcon, countKey: 'scheduled' },
  { href: '/sent', label: 'Sent', icon: SendIcon, countKey: 'sent' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { stats } = useStatsContext();

  return (
    <aside className="flex w-[230px] shrink-0 flex-col gap-4 border-r border-border-subtle px-4 py-5">
      <Wordmark className="ml-1 h-5 w-auto text-foreground" />

      <UserCard />

      <Button
        variant="outline"
        pill
        fullWidth
        data-testid="compose-button"
        onClick={() => router.push('/compose')}
      >
        Compose
      </Button>

      <nav className="mt-1 flex flex-col gap-0.5">
        <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          Core
        </p>

        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const count = stats?.[item.countKey];

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              data-testid={`nav-${item.countKey}`}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                active
                  ? 'bg-brand-green-light font-semibold text-brand-green-dark'
                  : 'text-foreground hover:bg-surface-muted',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              <span
                data-testid={`nav-count-${item.countKey}`}
                className={cn(
                  'shrink-0 text-[11px] tabular-nums',
                  active ? 'text-brand-green-dark/70' : 'text-text-muted',
                )}
              >
                {/* An em dash while stats are still loading, so the row does
                    not jump when the number arrives. */}
                {count ?? '—'}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
