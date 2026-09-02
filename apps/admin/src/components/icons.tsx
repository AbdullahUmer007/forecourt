/**
 * The icons, drawn here rather than installed.
 *
 * A library would be the obvious move and it is the wrong one for two glyphs:
 * the smallest credible package is heavier than this whole file and arrives
 * with a house stroke weight that is not ours. These are 24px grid, 1.75
 * stroke, `currentColor` throughout — so they inherit the text colour and
 * need no dark-mode values of their own.
 *
 * Only the theme pair lives here. The CRM's set is larger because it has a
 * sidebar to label; this application has a single masthead and no navigation
 * glyphs, so copying the rest would be twelve paths nothing renders.
 *
 * Both are `aria-hidden`. An icon in this product always sits beside its own
 * label or an `aria-label` on the control (rule 2), so announcing it would
 * read the name twice.
 */

interface IconProps {
  /** Rendered size in px. The grid is 24, so anything else scales the stroke. */
  size?: number;
  className?: string;
}

function Svg({ size = 20, className = '', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function SunIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </Svg>
  );
}

export function MoonIcon(p: IconProps) {
  return <Svg {...p}><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" /></Svg>;
}
