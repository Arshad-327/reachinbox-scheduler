/**
 * Display formatting for wire values.
 *
 * All timestamps arrive as ISO-8601 strings and are rendered in the VIEWER's
 * local timezone, which is what someone watching a send window actually wants.
 */

/**
 * "Tue 9:15:12 AM" — the exact shape the Figma's scheduled pill uses.
 *
 * Built from Intl parts rather than a template string so the weekday
 * abbreviation and the AM/PM marker follow the browser's locale instead of
 * being hardcoded English.
 */
export function formatScheduleTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);

  return `${weekday} ${time}`;
}

/** "3 Nov, 10:23 AM" — used for the sent timestamp on hover. */
export function formatFullTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** Initials for the avatar fallback: "Oliver Brown" -> "OB", "x@y.io" -> "X". */
export function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name ?? '').trim() || (email ?? '').trim();
  if (!source) return '?';

  // An email has no meaningful second word — take one letter rather than
  // splitting "oliver.brown@domain.io" into nonsense.
  if (!name?.trim() && source.includes('@')) {
    return source[0]!.toUpperCase();
  }

  const words = source.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';

  return (first + last).toUpperCase() || '?';
}

/** "Showing 1-25 of 785" for the pagination footer. */
export function rangeLabel(page: number, limit: number, total: number): string {
  if (total === 0) return 'Showing 0 of 0';
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  return `Showing ${start}-${end} of ${total}`;
}
