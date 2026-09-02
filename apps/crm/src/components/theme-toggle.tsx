'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

const STORAGE_KEY = 'rixdrive-theme';

/**
 * Light or dark, chosen by the dealer and remembered on the machine.
 *
 * Deliberately not offered as a third "system" option. A forecourt PC is
 * often set up once by whoever unboxed it and never looked at again, so
 * "system" is not a preference anybody expressed — it is a default nobody
 * chose, and it was previously the only setting available. Two states, one
 * of which is the one you asked for.
 *
 * The attribute is set in <head> before first paint (see the root layout);
 * this component only reads back what is already there, which is why the
 * initial state is resolved in an effect rather than during render. Rendering
 * a guess would give the wrong icon for one frame on every load.
 */
export function ThemeToggle({ labelled = false }: { labelled?: boolean }) {
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
    return <span aria-hidden="true" className={labelled ? 'block h-10' : 'block size-9'} />;
  }

  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  const Icon = dark ? SunIcon : MoonIcon;

  if (labelled) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-ink-muted hover:bg-surface-3 hover:text-ink"
      >
        <Icon size={18} />
        <span className="truncate">{dark ? 'Light theme' : 'Dark theme'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="grid size-9 place-items-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
    >
      <Icon size={18} />
    </button>
  );
}
