'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

/*
 * Not the CRM's key. See the theme script in the root layout: this is a
 * separate deployment with its own audience, and the two choices are not one
 * choice.
 */
const STORAGE_KEY = 'rixdrive-admin-theme';

/**
 * Light or dark, chosen by the operator and remembered on the machine.
 *
 * Deliberately not offered as a third "system" option. "System" is not a
 * preference anybody expressed — it is a default nobody chose, and following
 * it was previously the only behaviour available here, which meant an operator
 * on a machine set to dark had a dark admin and no way to say otherwise.
 * Two states, one of which is the one you asked for.
 *
 * The attribute is set in <head> before first paint (see the root layout);
 * this component only reads back what is already there, which is why the
 * initial state is resolved in an effect rather than during render. Rendering
 * a guess would give the wrong icon for one frame on every load.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.dataset['theme'] === 'dark');
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);

    if (next) document.documentElement.dataset['theme'] = 'dark';
    else delete document.documentElement.dataset['theme'];

    // A machine with storage disabled still gets the switch, just not the
    // memory of it — which is a far better failure than the button throwing.
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* Private mode, or storage full. The theme still applied. */
    }
  }

  // Before the effect runs there is no honest answer, and an icon that flips
  // on hydration is worse than a reserved space that does not.
  if (dark === null) {
    return <span aria-hidden="true" className="block size-11" />;
  }

  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  const Icon = dark ? SunIcon : MoonIcon;

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      // 44px rather than the CRM's 36px, so it matches the height of the
      // sign-out control it sits beside in the masthead.
      className="grid size-11 place-items-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
    >
      <Icon size={18} />
    </button>
  );
}
