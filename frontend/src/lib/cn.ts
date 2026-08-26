/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately not clsx/tailwind-merge: nothing here needs conflict
 * resolution, and one four-line helper beats two dependencies.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
