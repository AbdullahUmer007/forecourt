import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * The typefaces are LOADED, not merely named.
 *
 * `--font-sans` listed Inter and every machine without it fell through to the
 * next entry — which on Windows is Segoe UI. The product was designed around
 * Inter's metrics and shipped in something else on most of the desks it runs
 * on, and that mismatch is most of what made a correctly-built screen look
 * unconsidered. `display: swap` keeps the text visible while it arrives, and
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

/**
 * `template`, not a single title.
 *
 * Every page in the CRM rendered the product name in the tab. An administrator
 * is described in the domain skill as somebody at a desk for hours with the
 * stock list, an invoice and the VAT book open at once — and all three tabs
 * said the same word, so picking one meant clicking through them. The section
 * name goes first because a tab strip truncates from the right.
 */
export const metadata = {
  title: { default: 'RixDrive', template: '%s · RixDrive' },
  description: 'Office CRM for independent used-car dealers.',
};

// Every screen reads live data behind a tenant context, so nothing here is
// statically renderable.
export const dynamic = 'force-dynamic';

/**
 * Applied before first paint, which is the only time it can be.
 *
 * A dealer who chose dark would otherwise get a white flash on every
 * navigation while React hydrated and set the attribute — worst on the
 * machine in a dim workshop that the setting exists for. This runs
 * synchronously in <head>, ahead of any pixels.
 *
 * Light is the default and the fallback: an unreadable preference, a
 * localStorage that throws in private mode, or no choice ever made all land
 * on the same theme rather than on whatever the laptop happens to prefer.
 */
const THEME_SCRIPT = `
try {
  var d = document.documentElement;
  if (localStorage.getItem('rixdrive-theme') === 'dark') d.dataset.theme = 'dark';
  if (localStorage.getItem('rixdrive-nav') === 'collapsed') d.dataset.nav = 'collapsed';
} catch (e) {}
`;

/**
 * The root layout carries no chrome and reads no session.
 *
 * The shell lives in the `(app)` route group instead, so /sign-in — which by
 * definition has no session — does not render navigation that needs one. A
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
