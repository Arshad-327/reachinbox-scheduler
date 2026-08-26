'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';

/**
 * Builds the "Tomorrow, 10:00 AM" style quick picks from the Figma.
 *
 * Computed at open time rather than module load: a tab left open overnight
 * would otherwise offer a "tomorrow" that is already yesterday.
 */
function quickPicks(now: Date): Array<{ label: string; date: Date }> {
  return [10, 11, 15].map((hour) => {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(hour, 0, 0, 0);

    const time = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);

    return { label: `Tomorrow, ${time}`, date };
  });
}

/**
 * `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time. toISOString() is
 * UTC and would shift the value by the timezone offset, so the parts are
 * assembled by hand.
 */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface SendLaterPopoverProps {
  /** Currently chosen time, or null for "send now". */
  value: Date | null;
  onChange: (next: Date | null) => void;
  onClose: () => void;
}

export function SendLaterPopover({ value, onChange, onClose }: SendLaterPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Date | null>(value);
  const [error, setError] = useState<string | null>(null);

  const picks = useMemo(() => quickPicks(new Date()), []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function confirm(next: Date | null) {
    // The API rejects a startTime more than a minute in the past
    // (START_TIME_GRACE_MS in campaign.service.ts). Catching it here means an
    // inline message instead of a round-trip and a 400.
    if (next && next.getTime() < Date.now() - 60_000) {
      setError('Pick a time in the future.');
      return;
    }
    setError(null);
    onChange(next);
    onClose();
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Send later"
      data-testid="send-later-popover"
      className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] rounded-xl border border-border-subtle bg-white p-4 shadow-[0_8px_28px_-8px_rgba(16,24,40,0.22)]"
    >
      <p className="text-[14px] font-semibold text-foreground">Send Later</p>

      <div className="relative mt-3 flex items-center gap-2 border-b border-border-hairline pb-2">
        {/*
          datetime-local takes no placeholder — an empty one shows the browser's
          own "dd-mm-yyyy --:--" mask. The Figma shows "Pick date & time", so
          the text is painted underneath and the input's own glyphs are made
          transparent until it holds a value.
        */}
        {!draft ? (
          <span className="pointer-events-none absolute left-0 text-[13px] text-text-muted">
            Pick date &amp; time
          </span>
        ) : null}

        <input
          type="datetime-local"
          aria-label="Pick date and time"
          data-testid="send-later-datetime"
          value={draft ? toLocalInputValue(draft) : ''}
          min={toLocalInputValue(new Date())}
          onChange={(event) => {
            const next = event.target.value ? new Date(event.target.value) : null;
            setDraft(next && !Number.isNaN(next.getTime()) ? next : null);
            setError(null);
          }}
          className={cn(
            'w-full bg-transparent text-[13px] outline-none [&::-webkit-calendar-picker-indicator]:opacity-0',
            draft ? 'text-foreground' : 'text-transparent',
          )}
        />
        <CalendarDays className="h-4 w-4 shrink-0 text-text-muted" />
      </div>

      <p className="mt-3 text-[12px] text-text-secondary">Tomorrow</p>

      <div className="mt-1 flex flex-col">
        {picks.map((pick) => (
          <button
            key={pick.label}
            type="button"
            data-testid="quick-pick"
            onClick={() => {
              setDraft(pick.date);
              setError(null);
            }}
            className="-mx-2 rounded px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-muted"
          >
            {pick.label}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-status-red-fg">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Cancel clears any pending schedule as well as closing — the
            // button reverting to "Send" is the visible confirmation.
            onChange(null);
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          pill
          data-testid="send-later-done"
          onClick={() => confirm(draft)}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
