/**
 * The "ONB" wordmark.
 *
 * Drawn as geometry rather than set in a typeface. The Figma uses a blocky
 * display face with square corners and a single uniform stroke weight — no
 * font on the machine matches it, and setting it in a bold monospace reads
 * obviously wrong (tapered joins, round terminals, wrong proportions). Three
 * letters of stroke geometry with square caps gets far closer than any
 * substitute font, and it costs nothing at runtime.
 *
 * Grid: each glyph occupies 14 units across, 20 tall, stroke 3.6, with 5 units
 * of tracking between them.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 62 20"
      className={className}
      role="img"
      aria-label="ONB"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.6}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {/* O — a square ring, drawn as a rect so the corners stay sharp. */}
      <rect x="1.8" y="1.8" width="10.4" height="16.4" />

      {/* N — two uprights and the diagonal between them. */}
      <path d="M20.8 18.2V1.8" />
      <path d="M31.2 18.2V1.8" />
      <path d="M20.8 2.6 31.2 17.4" />

      {/* B — spine plus two square bowls. */}
      <path d="M39.8 1.8v16.4" />
      <path d="M39.8 1.8h8.6v6.2h-8.6" />
      <path d="M39.8 10h10.4v8.2H39.8" />
    </svg>
  );
}
