import { cn } from '@/lib/cn';

/**
 * Borrowed-colour spinner: the ring is drawn in `currentColor` with one
 * transparent quarter, so it inherits whatever text colour it sits in and needs
 * no variant of its own per button style.
 */
export function Spinner({
  className,
  label = 'Loading',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className ?? 'h-4 w-4',
      )}
    />
  );
}
