'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The primary navigation.
 *
 * A client component for one reason: the current page has to be marked, and a
 * server layout is not told which route rendered underneath it. Twelve
 * destinations with nothing indicating which one you are on is a nav somebody
 * has to read every time rather than glance at.
 *
 * It takes the already-filtered list. The permission decision stays in the
 * layout, on the server, where it cannot be edited from a console — this
 * component only draws what it is handed.
 *
 * Deliberately NOT importing anything from `@forecourt/domain`: this is a
 * client component, and the barrel drags `node:crypto` and the pricing logic
 * into the browser bundle. `forecourt/no-domain-barrel-in-client` enforces it.
 */
export function Nav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    // The nav gets its own full-width row, so twelve items do not have to
    // share a line with the brand and the sign-out button — which is what made
    // the header wrap into two ragged lines at 1440px. On a phone it scrolls
    // horizontally instead of being clipped, so Stock and Leads are reachable
    // rather than merely present in the markup.
    <nav aria-label="Sections" className="border-t border-edge">
      <div className="mx-auto max-w-[1280px] overflow-x-auto px-2">
        <ul className="flex min-w-max items-center gap-0.5 py-1">
          {items.map((item) => {
            // Exact match for the dashboard, prefix for everything else — so
            // /stock/019f… still marks Stock, and /stock does not mark every
            // section whose path happens to start with a slash.
            const active = item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 font-medium ${
                    active
                      ? 'bg-brand-50 text-link'
                      : 'text-ink-muted hover:bg-surface-3 hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
