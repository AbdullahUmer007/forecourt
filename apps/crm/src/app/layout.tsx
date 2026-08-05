import type { ReactNode } from 'react';
import './globals.css';

/**
 * `template`, not a single title.
 *
 * Every page in the CRM rendered "Forecourt" in the tab. An administrator is
 * described in the domain skill as somebody at a desk for hours with the stock
 * list, an invoice and the VAT book open at once — and all three tabs said the
 * same word, so picking one meant clicking through them. The section name goes
 * first because a tab strip truncates from the right.
 */
export const metadata = {
  title: { default: 'Forecourt', template: '%s · Forecourt' },
  description: 'Office CRM for independent used-car dealers.',
};

// Every screen reads live data behind a tenant context, so nothing here is
// statically renderable.
export const dynamic = 'force-dynamic';

/**
 * The root layout carries no chrome and reads no session.
 *
 * The masthead lives in the `(app)` route group instead, so /sign-in — which
 * by definition has no session — does not render a header that needs one. A
 * root layout that calls `requireSession()` above the sign-in page is a
 * redirect loop, and it is the kind nobody notices until they are actually
 * signed out.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
