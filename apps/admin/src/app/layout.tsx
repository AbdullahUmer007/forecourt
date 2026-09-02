import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * The typefaces are LOADED, not merely named.
 *
 * `--font-sans` listed Inter and every machine without it fell through to the
 * next entry — which on Windows is Segoe UI, so this application was designed
 * around Inter's metrics and shipped in something else on most of the desks it
 * runs on. `display: swap` keeps the text visible while it arrives, and
 * self-hosting through next/font means no third-party request on the critical
 * path and no layout shift when it lands.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

/** Registrations, VINs, stock numbers and invoice references. */
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-face',
});

export const metadata = {
  title: 'RixDrive platform admin',
  description: 'RixDrive staff only.',
  // Never indexed, never followed. This is not a public application and a
  // crawler finding a sign-in page for it is the beginning of a bad day.
  robots: { index: false, follow: false },
};

// Every screen reads live platform data, so nothing here is statically
// renderable — and a cached page in an application that reads across every
// dealership would be a cached page of somebody else's business.
export const dynamic = 'force-dynamic';

/**
 * Applied before first paint, which is the only time it can be.
 *
 * An operator who chose dark would otherwise get a white flash on every
 * navigation while React hydrated and set the attribute. This runs
 * synchronously in <head>, ahead of any pixels.
 *
 * The key is NOT the CRM's. This is a separate deployment with its own
 * audience, and an operator who wants a dark admin at 2am has not thereby
 * asked for a dark CRM — the same separation the cookie name already draws.
 *
 * Light is the default and the fallback: an unreadable preference, a
 * localStorage that throws in private mode, or no choice ever made all land
 * on the same theme rather than on whatever the laptop happens to prefer.
 */
const THEME_SCRIPT = `
try {
  var d = document.documentElement;
  if (localStorage.getItem('rixdrive-admin-theme') === 'dark') d.dataset.theme = 'dark';
} catch (e) {}
`;

/**
 * The root layout carries no chrome and reads no session.
 *
 * Visually distinct from the CRM on purpose: an operator with both open should
 * never be in doubt about which application they are typing into. The banner
 * in the (admin) group says whose data they are looking at.
 *
 * The masthead lives in the `(admin)` route group instead, so /sign-in — which
 * by definition has no session — does not render a header that needs one. A
 * root layout that calls `requireSession()` above the sign-in page is a
 * redirect loop, and it is the kind nobody notices until they are actually
 * signed out.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en-GB"
      className={`${inter.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
