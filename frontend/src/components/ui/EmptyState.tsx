import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/**
 * Shared empty/no-results panel. Used for a genuinely empty list and for a
 * search that matched nothing — the two differ only in their copy, which is
 * the caller's job to supply.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-20 text-center',
        className,
      )}
    >
      {icon ? (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
          {icon}
        </span>
      ) : null}

      <p className="text-sm font-semibold text-foreground">{title}</p>

      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-text-secondary">
          {description}
        </p>
      ) : null}

      {action ? (
        <Button variant="outline" size="sm" pill className="mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
