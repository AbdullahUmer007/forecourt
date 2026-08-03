import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Forecourt',
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
