import type { SVGProps } from 'react';

/**
 * The icon set, inlined.
 *
 * All of them are 24x24 stroke-based outlines sharing one set of stroke
 * attributes, which is what makes them look like a family at the 14-18px sizes
 * the design uses. Inlined rather than pulled from an icon package: the app
 * needs nine glyphs, and nine glyphs is not worth a dependency plus its
 * tree-shaking caveats.
 *
 * Size comes from the className (`h-4 w-4`), colour from `currentColor`, so an
 * icon always matches the text it sits next to.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

/** Paper plane, matching the Figma's "Sent" nav glyph. */
export function SendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.5 3.5 2.5 10.2l7.2 2.6 2.6 7.2z" />
      <path d="M9.7 12.8 21.5 3.5" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </Icon>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5h18l-7 8v6l-4-2v-4z" />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 4v4h-4" />
    </Icon>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3.8 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.9l5.8-.8z" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Icon>
  );
}

/** Empty-state glyph for the Scheduled view. */
export function InboxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M4.5 6.5 3 13v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5l-1.5-6.5a1 1 0 0 0-1-.5H5.5a1 1 0 0 0-1 .5z" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2h.01" />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
      <path d="M16 16l4-4-4-4" />
      <path d="M20 12H9" />
    </Icon>
  );
}
