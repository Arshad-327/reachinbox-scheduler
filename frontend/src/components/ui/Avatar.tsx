'use client';

import { useState } from 'react';

import { cn } from '@/lib/cn';
import { initialsFrom } from '@/lib/format';

/**
 * Avatar with an initials fallback that is the DEFAULT, not the error path.
 *
 * Why this is a plain <img> and not next/image
 * --------------------------------------------
 * The Google avatar (lh3.googleusercontent.com) was rendering as an empty box.
 * Measured, not guessed:
 *
 *   - the URL itself is fine: HTTP 200, 96x96, ~100-280ms, direct and through
 *     Next's optimizer alike, with and without a Referer;
 *   - but the page's own request for it intermittently stalled past 6s, and
 *     next/image emits `loading="lazy"` plus `style="color:transparent"`.
 *     That inline style suppresses alt text AND the browser's broken-image
 *     glyph, so a slow or failed load paints nothing at all — a 56x56 hole
 *     indistinguishable from a broken image.
 *
 * next/image buys nothing here anyway: the source is a fixed 96px square on
 * someone else's CDN, so there is no layout shift to prevent and no resizing
 * worth a server round-trip. A plain <img> removes the optimizer hop, the
 * `remotePatterns` coupling, and the transparent-text trap in one go.
 *
 * `referrerPolicy="no-referrer"` is the standard fix for hotlinking Google
 * avatars, and was consistently the fastest variant in the timing runs.
 *
 * The initials are painted underneath and are always there. The <img> is
 * layered on top and revealed only once it decodes, so a slow load shows
 * initials rather than a blank, and `onError` retires the image for good.
 */
export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  /** Rendered pixel size. */
  size?: number;
  className?: string;
}

export function Avatar({ src, name, email, size = 32, className }: AvatarProps) {
  // Stores WHICH url failed rather than a boolean, so a changed src is
  // automatically retried — no reset effect, and nothing to forget to clear.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const initials = initialsFrom(name, email);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-brand-green-light font-semibold text-brand-green-dark select-none',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      <span>{initials}</span>

      {showImage ? (
        // key={src} so a changed url remounts with fresh load state, which is
        // what removes the need for a reset effect entirely.
        <AvatarImage
          key={src}
          src={src!}
          name={name}
          size={size}
          onFail={() => setFailedSrc(src ?? null)}
        />
      ) : null}
    </span>
  );
}

function AvatarImage({
  src,
  name,
  size,
  onFail,
}: {
  src: string;
  name?: string | null;
  size: number;
  onFail: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    /* Deliberate, not an oversight: next/image's lazy default and its inline
       `color: transparent` are precisely why this avatar rendered as a blank
       box. See the component doc above for the measurements. */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name ? `${name}'s avatar` : 'Avatar'}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      // Explicitly eager: this is an above-the-fold identity element.
      loading="eager"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={onFail}
      className={cn(
        'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
        loaded ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}
