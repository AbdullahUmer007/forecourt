'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BrandMark, CloseIcon, CollapseIcon, ExpandIcon, MenuIcon, NAV_ICONS, type IconName,
} from './icons';
import { ThemeToggle } from './theme-toggle';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

/**
 * The authenticated shell.
 *
 * A client component because three things here depend on the browser — the
 * current route, the collapsed preference and the mobile drawer — and none of
 * them are knowable in a server layout. `children` is still rendered on the
 * server and passed through as an already-built tree, so making this a client
 * component costs the pages nothing.
 *
 * It replaced a two-row masthead. Twelve sections across the top could not fit
 * beside the brand and the sign-out control at 1440px, so they had a whole
 * second row to themselves, and a phone got a horizontally-scrolling strip
 * where Stock and Leads were reachable only by dragging. A left rail has room
 * for twelve destinations and room for the next twelve, gives every one of
 * them an icon that survives being collapsed to 68px, and hands the vertical
 * space back to the thing the dealer is actually reading.
 *
 * Deliberately NOT importing anything from `@forecourt/domain`: this is a
 * client component, and the barrel drags `node:crypto` and the pricing logic
 * into the browser bundle. `forecourt/no-domain-barrel-in-client` enforces it.
 */
export function AppShell(
  { items, tenantName, displayName, roleLabel, signOut, children }: {
    items: NavItem[];
    tenantName: string;
    displayName: string;
    roleLabel: string;
    /** The sign-out form, rendered on the server so the action stays there. */
    signOut: ReactNode;
    children: ReactNode;
  },
) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // The attribute is already correct — it was set in <head>. This only brings
  // React's copy into line so `aria-expanded` does not lie.
  useEffect(() => {
    setCollapsed(document.documentElement.dataset['nav'] === 'collapsed');
  }, []);

  // A drawer that survives navigation covers the page you just asked for.
  useEffect(() => { setDrawer(false); }, [pathname]);

  useEffect(() => {
    if (!drawer) return undefined;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawer(false);
    }
    document.addEventListener('keydown', onKey);
    // Without this the page behind the drawer scrolls under your thumb.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [drawer]);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);

    if (next) document.documentElement.dataset['nav'] = 'collapsed';
    else delete document.documentElement.dataset['nav'];

    try {
      localStorage.setItem('rixdrive-nav', next ? 'collapsed' : 'expanded');
    } catch {
      /* Storage unavailable. The rail still collapsed, it just won't remember. */
    }
  }, [collapsed]);

  return (
    <div className="min-h-dvh">
      {/* Keyboard users should not have to tab twelve destinations to reach the
          page, and this is the first focusable thing in the document. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      {/* ---------------------------------------------------------- desktop */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[var(--nav-w)] flex-col border-r border-edge bg-surface-1 lg:flex"
        aria-label="Main"
      >
        <Rail
          items={items}
          pathname={pathname}
          tenantName={tenantName}
          displayName={displayName}
          roleLabel={roleLabel}
          signOut={signOut}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>

      {/* ----------------------------------------------------------- mobile */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-edge bg-surface-1 px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-expanded={drawer}
          aria-label="Open navigation"
          className="grid size-11 place-items-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
        >
          <MenuIcon size={22} />
        </button>

        <Link href="/" className="flex min-w-0 items-center gap-2">
          <BrandMark size={26} className="text-brand-600" />
          <span className="truncate font-semibold tracking-tight">RixDrive</span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </header>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <div
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-edge bg-surface-1 shadow-(--shadow-overlay)"
          >
            <Rail
              items={items}
              pathname={pathname}
              tenantName={tenantName}
              displayName={displayName}
              roleLabel={roleLabel}
              signOut={signOut}
              collapsed={false}
              onClose={() => setDrawer(false)}
            />
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- page */}
      <div className="lg:pl-[var(--nav-w)]">
        <main id="main" className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The rail's contents, shared by the fixed desktop column and the mobile
 * drawer. They differ only in how they are positioned and whether they can be
 * collapsed, so drawing them twice would be two things to keep in step.
 */
function Rail(
  { items, pathname, tenantName, displayName, roleLabel, signOut, collapsed,
    onToggleCollapsed, onClose }: {
    items: NavItem[];
    pathname: string;
    tenantName: string;
    displayName: string;
    roleLabel: string;
    signOut: ReactNode;
    collapsed: boolean;
    onToggleCollapsed?: () => void;
    onClose?: () => void;
  },
) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <BrandMark size={28} className="text-brand-600" />
          <span className="nav-label truncate text-[15px] font-semibold tracking-tight">
            RixDrive
          </span>
        </Link>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="ml-auto grid size-11 place-items-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <CloseIcon size={20} />
          </button>
        )}
      </div>

      {/*
        Whose forecourt this is, directly under the brand.
        ─────────────────────────────────────────────────────────────────────
        It reads as a label rather than a heading because it is not a place
        you can go — but a group with two sites and one browser profile needs
        to see it without opening a menu.
      */}
      <div className="nav-label truncate border-b border-edge px-4 pb-3 text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
        {tenantName}
      </div>

      <nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            // Exact match for the dashboard, prefix for everything else — so
            // /stock/019f… still marks Stock, and /stock does not mark every
            // section whose path happens to start with a slash.
            const active = item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            const Icon = NAV_ICONS[item.icon];

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  // The title is the label a collapsed rail is hiding. It is
                  // the only state where the icon stands alone, and rule 2
                  // does not allow that to be the end of the story.
                  title={collapsed ? item.label : undefined}
                  className={`group relative flex min-h-11 items-center gap-3 rounded-md px-3 font-medium transition-colors duration-100 ${
                    active
                      ? 'bg-brand-50 text-link'
                      : 'text-ink-muted hover:bg-surface-3 hover:text-ink'
                  }`}
                >
                  {/*
                    The marker is a shape as well as a colour.
                    A tinted ground alone is a colour carrying meaning, and at
                    the indigo-50 end of the ramp it is a very quiet one.
                  */}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-sm bg-brand-600"
                    />
                  )}
                  <Icon size={19} />
                  <span className="nav-label truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-edge p-2">
        <ThemeToggle labelled />

        {/*
          Who you are signed in as, on the page rather than in a tooltip.
          A dealership where two people share a machine needs to be able to see
          whose name is about to go on the audit row.
        */}
        <div className="mt-1 flex items-center gap-2.5 rounded-md px-2 py-2">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-[12px] font-semibold text-link"
          >
            {initials(displayName)}
          </span>

          <div className="nav-label min-w-0 flex-1">
            <div className="truncate font-medium">{displayName}</div>
            <div className="truncate text-[12px] leading-4 text-ink-subtle">{roleLabel}</div>
          </div>

          <div className="nav-label shrink-0">{signOut}</div>
        </div>

        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="mt-1 hidden h-9 w-full items-center gap-3 rounded-md px-3 text-ink-subtle hover:bg-surface-3 hover:text-ink lg:flex"
          >
            {collapsed ? <ExpandIcon size={18} /> : <CollapseIcon size={18} />}
            <span className="nav-label truncate">Collapse</span>
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Two letters, from the first and last word.
 *
 * A single-word name gives one letter rather than a padded pair, and anything
 * that is not a letter is dropped — a display name of "—" should produce an
 * empty circle, not a stray dash pretending to be an initial.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';

  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';

  return `${first}${last}`.replace(/[^\p{L}]/gu, '').toUpperCase();
}
