import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { EmailStatus } from '@/types/api';
import { ClockIcon } from './icons';

/**
 * THE one place status becomes colour.
 *
 * Nothing else in the app is allowed to branch on EmailStatus for styling. Add
 * a status to the Prisma enum and the compiler points here — the Record types
 * below are exhaustive over EmailStatus, so a missing case is a build error
 * rather than an unstyled grey pill discovered in review.
 */
export type BadgeVariant = 'scheduled' | 'sent' | 'failed' | 'cancelled';

const STATUS_VARIANT: Record<EmailStatus, BadgeVariant> = {
  // The three pre-send states share the amber "upcoming" treatment; they differ
  // by label, not by colour, because to the user they are all "not yet gone".
  SCHEDULED: 'scheduled',
  QUEUED: 'scheduled',
  PROCESSING: 'scheduled',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const STATUS_LABEL: Record<EmailStatus, string> = {
  SCHEDULED: 'Scheduled',
  QUEUED: 'Queued',
  PROCESSING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  scheduled: 'bg-status-amber-bg text-status-amber-fg',
  sent: 'bg-status-grey-bg text-status-grey-fg',
  failed: 'bg-status-red-bg text-status-red-fg',
  cancelled: 'bg-status-slate-bg text-status-slate-fg',
};

/** Only the upcoming states carry the clock, matching the Figma. */
const VARIANT_HAS_CLOCK: Record<BadgeVariant, boolean> = {
  scheduled: true,
  sent: false,
  failed: false,
  cancelled: false,
};

export function statusVariant(status: EmailStatus): BadgeVariant {
  return STATUS_VARIANT[status];
}

export function statusLabel(status: EmailStatus): string {
  return STATUS_LABEL[status];
}

export interface BadgeProps {
  status: EmailStatus;
  /**
   * Overrides the default label. The scheduled rows pass the formatted send
   * time here ("Tue 9:15:12 AM") instead of the word "Scheduled".
   */
  children?: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ status, children, className, title }: BadgeProps) {
  const variant = STATUS_VARIANT[status];

  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1',
        'text-[11px] font-medium leading-none whitespace-nowrap',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {VARIANT_HAS_CLOCK[variant] ? <ClockIcon className="h-3 w-3" /> : null}
      {children ?? STATUS_LABEL[status]}
    </span>
  );
}
