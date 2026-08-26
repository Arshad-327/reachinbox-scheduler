import type { CSSProperties } from 'react';

import { cn } from '@/lib/cn';

/**
 * Shimmer placeholder.
 *
 * The sweep is a background-position animation on a gradient rather than a
 * pulsing opacity, so a column of skeleton rows reads as one surface loading
 * instead of several blocks blinking out of phase. Keyframes live in
 * globals.css as `skeleton-sweep`.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        'block rounded-md bg-surface-muted',
        'bg-[linear-gradient(90deg,var(--surface-muted)_0%,var(--skeleton-highlight)_50%,var(--surface-muted)_100%)]',
        'bg-[length:200%_100%] motion-safe:animate-[skeleton-sweep_1.4s_ease-in-out_infinite]',
        className,
      )}
    />
  );
}
