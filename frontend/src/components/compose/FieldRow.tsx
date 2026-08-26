import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface FieldRowProps {
  label: string;
  /** Associates the label with the control it names. */
  htmlFor?: string;
  children: ReactNode;
  /** Pinned to the right of the row — "Upload List" on the To row. */
  trailing?: ReactNode;
  /** Inline validation message, rendered under the row in red. */
  error?: string;
  /** Extra context under the row, e.g. the upload summary line. */
  hint?: ReactNode;
  /** The From row in the Figma has no separator beneath it. */
  divider?: boolean;
  className?: string;
}

/**
 * One labelled line of the compose form.
 *
 * The Figma lays these out as a fixed label column with the control flowing
 * beside it and a hairline underneath — not as stacked label-above-input
 * groups. Keeping that in one component is what makes every row line up on the
 * same two x positions.
 */
export function FieldRow({
  label,
  htmlFor,
  children,
  trailing,
  error,
  hint,
  divider = true,
  className,
}: FieldRowProps) {
  return (
    <div className={cn(divider && 'border-b border-border-hairline', className)}>
      <div className="flex items-center gap-4 py-3">
        {/*
          min-width, not a fixed width. The Figma aligns every label to the
          same left edge and lets the control follow it, so the short labels
          (From / To / Subject) line their controls up at 130px while
          "Delay between 2 emails" runs long and pushes its inputs right.
        */}
        <label
          htmlFor={htmlFor}
          className="min-w-[130px] shrink-0 whitespace-nowrap text-[13px] font-medium text-foreground"
        >
          {label}
        </label>

        {/* min-w-0 so long chip rows and inputs truncate instead of pushing
            the trailing slot off the edge. */}
        <div className="min-w-0 flex-1">{children}</div>

        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>

      {error ? (
        <p role="alert" className="pb-2 pl-[146px] text-[12px] text-status-red-fg">
          {error}
        </p>
      ) : null}

      {hint && !error ? (
        <div className="pb-2 pl-[146px] text-[12px] text-text-secondary">{hint}</div>
      ) : null}
    </div>
  );
}
