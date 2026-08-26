'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md';

/**
 * `outline` is the Figma's Compose button: white fill, green border, green
 * text, fully rounded. It is NOT a green fill — that is `primary`, which the
 * login screen uses. Keeping both here stops the two being reinvented, subtly
 * differently, in each place they appear.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-green text-white border border-transparent hover:bg-brand-green-hover focus-visible:outline-brand-green',
  outline:
    'bg-white text-brand-green border border-brand-green hover:bg-brand-green-light focus-visible:outline-brand-green',
  ghost:
    'bg-transparent text-text-secondary border border-transparent hover:bg-surface-muted hover:text-foreground focus-visible:outline-brand-green',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the leading content for a spinner and blocks interaction. */
  loading?: boolean;
  /** Pill radius. The Compose button in the Figma is fully rounded. */
  pill?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  pill = false,
  fullWidth = false,
  leadingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  // A loading button is disabled too — otherwise a double click fires the
  // action twice while the first is still in flight.
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-55',
        pill ? 'rounded-full' : 'rounded-lg',
        fullWidth && 'w-full',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leadingIcon}
      {children}
    </button>
  );
}
