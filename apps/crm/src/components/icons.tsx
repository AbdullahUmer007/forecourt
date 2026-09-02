/**
 * The icon set, drawn here rather than installed.
 *
 * A library would be the obvious move, and it is the wrong one for twelve
 * glyphs: the smallest credible package is heavier than this whole file, it
 * arrives with a house stroke weight that is not ours, and the public site
 * shares a JS budget of 120KB that a barrel import is very good at quietly
 * spending. These are 24px grid, 1.75 stroke, `currentColor` throughout — so
 * they inherit the text colour and need no dark-mode values of their own.
 *
 * Every one is `aria-hidden`. An icon in this product always sits beside its
 * own label (rule 2), so announcing it would read the name twice.
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

export type IconName =
  | 'dashboard' | 'appraisal' | 'prep' | 'stock' | 'leads' | 'deals'
  | 'invoices' | 'vat' | 'channels' | 'reports' | 'compliance' | 'accounting';

export function DashboardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="4.5" rx="1.5" />
      <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </Svg>
  );
}

/** Part-exchange: two cars swapping places. */
export function AppraisalIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8h11l-1.6-3.2A2 2 0 0 0 10.6 3.7H6.4a2 2 0 0 0-1.8 1.1L3 8Z" />
      <path d="M3 8v4.5h11V8" />
      <circle cx="5.8" cy="12.5" r="1.2" />
      <circle cx="11.2" cy="12.5" r="1.2" />
      <path d="M17.5 14v6.5M17.5 20.5 15 18M17.5 20.5 20 18" />
    </Svg>
  );
}

/** Prep: a spanner. */
export function PrepIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15.2 3.6a5 5 0 0 0-6.4 6.2L3.7 14.9a2.2 2.2 0 0 0 3.1 3.1l5.1-5.1a5 5 0 0 0 6.2-6.4l-2.9 2.9-2.6-.7-.7-2.6 2.3-2.5Z" />
    </Svg>
  );
}

/** Stock: a car, three-quarter silhouette. */
export function StockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 12.5h17l-2.2-4.6A2.5 2.5 0 0 0 16 6.4H8a2.5 2.5 0 0 0-2.3 1.5L3.5 12.5Z" />
      <path d="M3.5 12.5V17h17v-4.5" />
      <circle cx="7.3" cy="17" r="1.6" />
      <circle cx="16.7" cy="17" r="1.6" />
    </Svg>
  );
}

export function LeadsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.2 19.5a5.8 5.8 0 0 1 11.6 0" />
      <path d="M16.4 5.2a3.2 3.2 0 0 1 0 5.9" />
      <path d="M18 14.6a5.8 5.8 0 0 1 2.8 4.9" />
    </Svg>
  );
}

/** Deals: a signed document. */
export function DealsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3h7.5L19 8.2V15" />
      <path d="M13 3v5.5h5.5" />
      <path d="M6 3v15.5" />
      <path d="M5 20.5c1.6 0 1.6-2 3.2-2s1.6 2 3.2 2 1.6-2 3.2-2 1.6 2 3.2 2" />
    </Svg>
  );
}

export function InvoicesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 3h14v18l-2.3-1.6-2.4 1.6-2.3-1.6L9.7 21l-2.4-1.6L5 21V3Z" />
      <path d="M9 8h6M9 12h6" />
    </Svg>
  );
}

/** VAT book: a ledger. */
export function VatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H19v15H6.2A2.2 2.2 0 0 0 4 20.2V5.2Z" />
      <path d="M4 20.2A2.2 2.2 0 0 1 6.2 18H19v3H6.2A2.2 2.2 0 0 1 4 18.8" />
      <path d="M8.5 8h6" />
    </Svg>
  );
}

/** Channel P&L: a bar chart. */
export function ReportsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20.5h16.5" />
      <rect x="5" y="12" width="3.6" height="6" rx="1" />
      <rect x="10.3" y="7.5" width="3.6" height="10.5" rx="1" />
      <rect x="15.6" y="4" width="3.6" height="14" rx="1" />
    </Svg>
  );
}

/** Channels: a broadcast node. */
export function ChannelsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" />
    </Svg>
  );
}

export function ComplianceIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 5 5.8v5.4c0 4.3 2.9 8.2 7 9.4 4.1-1.2 7-5.1 7-9.4V5.8L12 3Z" />
      <path d="m9 12 2.2 2.2L15.2 10" />
    </Svg>
  );
}

/** Accounting: a ledger balance. */
export function AccountingIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4v16" />
      <path d="M5 7h14" />
      <path d="M8.4 7 5 14a3.4 3.4 0 0 0 6.8 0L8.4 7Z" />
      <path d="M15.6 7 12.2 14a3.4 3.4 0 0 0 6.8 0L15.6 7Z" />
    </Svg>
  );
}

export const NAV_ICONS: Record<IconName, (p: IconProps) => React.ReactElement> = {
  dashboard: DashboardIcon,
  appraisal: AppraisalIcon,
  prep: PrepIcon,
  stock: StockIcon,
  leads: LeadsIcon,
  deals: DealsIcon,
  invoices: InvoicesIcon,
  vat: VatIcon,
  reports: ReportsIcon,
  channels: ChannelsIcon,
  compliance: ComplianceIcon,
  accounting: AccountingIcon,
};

// ------------------------------------------------------------------ chrome

export function MenuIcon(p: IconProps) {
  return <Svg {...p}><path d="M4 6.5h16M4 12h16M4 17.5h16" /></Svg>;
}

export function CloseIcon(p: IconProps) {
  return <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
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

export function SignOutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5" />
      <path d="M10 8.5 13.5 12 10 15.5M13.5 12H4.5" />
    </Svg>
  );
}

export function CollapseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 4.5v15" />
      <path d="M13.5 8.5 10 12l3.5 3.5M10 12h6" />
    </Svg>
  );
}

export function ExpandIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4.5v15" />
      <path d="M10.5 8.5 14 12l-3.5 3.5M14 12H8" />
    </Svg>
  );
}

/**
 * The RixDrive mark.
 *
 * An R cut by the road it drives: filled rather than stroked, because at 28px
 * a 1.75 stroke on a letterform turns to mush. It carries the brand colour
 * through `currentColor` so it needs no dark variant.
 */
export function BrandMark({ size = 28, className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M10 8.5h6.9c2.9 0 4.7 1.7 4.7 4.2 0 1.9-1 3.3-2.7 3.9l3 6.9h-3.9l-2.6-6.3h-2v6.3H10V8.5Zm3.4 2.9v3.2h3c1.2 0 1.9-.6 1.9-1.6s-.7-1.6-1.9-1.6h-3Z"
        fill="var(--color-surface-1)"
      />
    </svg>
  );
}
