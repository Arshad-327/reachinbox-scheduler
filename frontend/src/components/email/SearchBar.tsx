'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/Input';
import { FilterIcon, RefreshIcon, SearchIcon } from '@/components/ui/icons';

const DEBOUNCE_MS = 300;

export interface SearchBarProps {
  /** Fires with the debounced value, not on every keystroke. */
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

/**
 * Search field plus the filter and refresh affordances from the Figma.
 *
 * The field owns its keystroke-by-keystroke value and only pushes upward after
 * 300ms of quiet. Lifting every keystroke and debouncing in the parent would
 * work too, but then the field's responsiveness would be tied to the parent's
 * render cycle — typing would lag behind the caret whenever a fetch resolved.
 */
export function SearchBar({ onSearchChange, onRefresh, refreshing = false }: SearchBarProps) {
  const [value, setValue] = useState('');

  // Held in a ref so the debounce timer always calls the latest callback
  // without the callback's identity restarting the timer on every parent
  // render. Assigned in an effect, never during render.
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the mount pass: the parent already starts with an empty query, and
    // emitting one here would fire a redundant fetch on every page load.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const timer = setTimeout(() => onSearchChangeRef.current(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="flex items-center gap-2 px-6 py-4">
      <Input
        pill
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search"
        aria-label="Search emails by recipient or subject"
        data-testid="search-input"
        type="search"
        leadingIcon={<SearchIcon className="h-4 w-4" />}
        // NOT full width. Measured off the Figma: the field occupies ~55.6%
        // of the main pane with the two icons immediately after it and empty
        // space to the right, rather than stretching to the edge.
        containerClassName="w-full max-w-[580px]"
        className="h-10"
      />

      <button
        type="button"
        aria-label="Filter"
        title="Filters are not built yet"
        onClick={() =>
          toast.info('Filters are not built yet', {
            description: 'The API supports ?status= — the control lands with Compose.',
          })
        }
        className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-muted hover:text-text-secondary"
      >
        <FilterIcon className="h-4 w-4" />
      </button>

      <button
        type="button"
        aria-label="Refresh"
        title="Refresh"
        data-testid="refresh-button"
        onClick={onRefresh}
        disabled={refreshing}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-muted hover:text-text-secondary disabled:opacity-60"
      >
        <RefreshIcon className={cn('h-4 w-4', refreshing && 'animate-spin')} />
      </button>
    </div>
  );
}
