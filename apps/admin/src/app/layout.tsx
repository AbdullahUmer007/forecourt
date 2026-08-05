import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Forecourt platform admin',
  description: 'Forecourt staff only.',
  // Never indexed, never followed. This is not a public application and a
  // crawler finding a sign-in page for it is the beginning of a bad day.
  robots: { index: false, follow: false },
};

// Every screen reads live platform data, so nothing here is statically
// renderable — and a cached page in an application that reads across every
// dealership would be a cached page of somebody else's business.
export const dynamic = 'force-dynamic';

/**
 * The root layout carries no chrome and reads no session.
 *
 * Visually distinct from the CRM on purpose: an operator with both open should
 * never be in doubt about which application they are typing into. The banner
 * in the (admin) group says whose data they are looking at.
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
