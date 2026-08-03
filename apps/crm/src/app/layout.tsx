import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireSession } from '../session';
import './globals.css';

export const metadata = {
  title: 'Forecourt',
  description: 'Office CRM for independent used-car dealers.',
};

// Every screen reads live data behind a tenant context, so nothing here is
// statically renderable.
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/appraisals', label: 'Part-exchange' },
  { href: '/stock', label: 'Stock' },
  { href: '/leads', label: 'Leads' },
  { href: '/deals', label: 'Deals' },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <html lang="en-GB">
      <body>
        {session.development && (
          // Loud on purpose. An auth bypass you cannot see is an auth bypass
          // that reaches a customer's data.
          <div className="bg-warning px-4 py-1.5 text-center text-[12px] leading-4 font-medium text-black">
            Development session — signed in as {session.displayName} ({session.roleKey}) without
            a password. No authentication is built yet.
          </div>
        )}

        <header className="sticky top-0 z-10 border-b border-edge bg-surface-1">
          <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 py-2">
            <Link href="/" className="font-semibold tracking-tight">
              Forecourt
            </Link>
            <span className="hidden text-ink-subtle sm:inline">{session.tenantName}</span>

            <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-ink-muted hover:bg-surface-3 hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1280px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
