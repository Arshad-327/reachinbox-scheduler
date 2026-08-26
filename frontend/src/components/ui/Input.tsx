'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered inside the field, before the text. */
  leadingIcon?: ReactNode;
  /** Rendered inside the field, after the text — a clear button, say. */
  trailingSlot?: ReactNode;
  /** The search field in the Figma is a fully rounded grey pill. */
  pill?: boolean;
  containerClassName?: string;
}

export function Input({
  leadingIcon,
  trailingSlot,
  pill = false,
  className,
  containerClassName,
  ...props
}: InputProps) {
  return (
    <div
      className={cn(
        'relative flex items-center',
        containerClassName,
      )}
    >
      {leadingIcon ? (
        // pointer-events-none so a click on the icon still focuses the field
        // behind it rather than landing on a dead zone.
        <span className="pointer-events-none absolute left-3.5 flex items-center text-text-muted">
          {leadingIcon}
        </span>
      ) : null}

      <input
        className={cn(
          'w-full bg-surface-muted text-[13px] text-foreground placeholder:text-text-muted',
          'border border-transparent outline-none transition-colors',
          'focus:border-border-subtle focus:bg-white',
          'disabled:cursor-not-allowed',
          pill ? 'rounded-full' : 'rounded-lg',
          'h-9',
          leadingIcon ? 'pl-10' : 'pl-3.5',
          trailingSlot ? 'pr-10' : 'pr-3.5',
          className,
        )}
        {...props}
      />

      {trailingSlot ? (
        <span className="absolute right-2.5 flex items-center">{trailingSlot}</span>
      ) : null}
    </div>
  );
}
