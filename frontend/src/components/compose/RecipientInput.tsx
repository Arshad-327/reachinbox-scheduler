'use client';

import { useMemo, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';

import { cn } from '@/lib/cn';

/**
 * Mirrors the backend's EMAIL_RE (upload.routes.ts) on purpose: one @, no
 * whitespace or separators, a dotted TLD of at least two letters. Deliberately
 * permissive — full RFC 5322 is unmatchable by regex, and rejecting an
 * odd-but-valid address is worse here than accepting one that will bounce.
 */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

export interface Recipient {
  email: string;
  name?: string;
  /** Failed validation; rendered as a red chip and excluded from submission. */
  invalid?: boolean;
}

export interface RecipientInputProps {
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  /** Above this many, the row collapses to "chip chip chip (+N)". */
  collapseAfter?: number;
  inputId?: string;
  placeholder?: string;
  invalid?: boolean;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * Chip/token input for the To row.
 *
 * Enter, comma and space all commit the current token — people paste from all
 * three conventions and none of them is more "correct" than the others. Paste
 * is intercepted so a whole comma- or newline-separated list becomes chips in
 * one go rather than a single unusable token.
 *
 * Invalid addresses are kept as red chips rather than silently dropped: a
 * typo the user can see and fix beats a recipient that quietly vanished.
 */
export function RecipientInput({
  value,
  onChange,
  collapseAfter = 3,
  inputId,
  placeholder = 'recipient@example.com',
  invalid = false,
}: RecipientInputProps) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const invalidCount = useMemo(() => value.filter((r) => r.invalid).length, [value]);

  const collapsed = !expanded && value.length > collapseAfter;
  const visible = collapsed ? value.slice(0, collapseAfter) : value;
  const hiddenCount = value.length - visible.length;

  function commit(raw: string): void {
    // One paste can carry a whole list; split on every separator we accept.
    const tokens = raw
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) return;

    const existing = new Set(value.map((r) => r.email.toLowerCase()));
    const additions: Recipient[] = [];

    for (const token of tokens) {
      const key = token.toLowerCase();
      // De-duplicating here as well as server-side keeps the visible count
      // honest — the backend would drop these anyway, silently.
      if (existing.has(key)) continue;
      existing.add(key);
      additions.push(isValidEmail(token) ? { email: token } : { email: token, invalid: true });
    }

    if (additions.length > 0) {
      onChange([...value, ...additions]);
    }
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      // Space only commits when there is something to commit, otherwise the
      // user cannot type a space at all.
      if (event.key === ' ' && draft.trim() === '') return;
      event.preventDefault();
      commit(draft);
      return;
    }

    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
      // Removing from the tail while collapsed is confusing if the tail is
      // hidden, so reveal the full list on the first such deletion.
      setExpanded(true);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text');
    if (!/[\s,;]/.test(text)) return; // a single address: let it type normally
    event.preventDefault();
    commit(text);
  }

  return (
    <div>
      <div
        // Clicking anywhere on the row focuses the field, the way a real
        // token input behaves.
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex min-h-[34px] flex-wrap items-center gap-1.5',
          invalid && 'ring-1 ring-status-red-fg/40 rounded-md px-1',
        )}
      >
        {visible.map((recipient, index) => (
          <span
            key={`${recipient.email}-${index}`}
            data-testid="recipient-chip"
            data-invalid={recipient.invalid ? 'true' : 'false'}
            title={recipient.invalid ? 'Not a valid email address' : recipient.email}
            className={cn(
              'inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1',
              'text-[12px] leading-none',
              recipient.invalid
                ? 'border-status-red-fg/50 bg-status-red-bg text-status-red-fg'
                : 'border-brand-green bg-brand-green-light text-foreground',
            )}
          >
            <span className="truncate">{recipient.email}</span>
            <button
              type="button"
              aria-label={`Remove ${recipient.email}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((_, i) => i !== value.indexOf(recipient)));
              }}
              className="shrink-0 text-current opacity-50 transition-opacity hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}

        {collapsed ? (
          <button
            type="button"
            data-testid="chip-overflow"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(true);
            }}
            title={`Show ${hiddenCount} more`}
            className="inline-flex items-center rounded-full border border-brand-green bg-brand-green-light px-2.5 py-1 text-[12px] leading-none text-foreground transition-colors hover:bg-brand-green-light-hover"
          >
            +{hiddenCount}
          </button>
        ) : null}

        {expanded && value.length > collapseAfter ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(false);
            }}
            className="text-[12px] text-text-secondary underline-offset-2 hover:underline"
          >
            collapse
          </button>
        ) : null}

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="email"
          autoComplete="off"
          data-testid="recipient-input"
          value={draft}
          placeholder={value.length === 0 ? placeholder : ''}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          // Commit whatever is half-typed when focus leaves, so a click on
          // Send does not silently discard the address in the box.
          onBlur={() => commit(draft)}
          className="min-w-[180px] flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-muted"
        />
      </div>

      {invalidCount > 0 ? (
        <p data-testid="invalid-count" className="pt-1 text-[12px] text-status-red-fg">
          {invalidCount} invalid {invalidCount === 1 ? 'address' : 'addresses'} — fix or remove
          {invalidCount === 1 ? ' it' : ' them'} before sending.
        </p>
      ) : null}
    </div>
  );
}
