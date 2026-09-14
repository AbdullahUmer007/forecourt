'use client';

import { useState, type FormEvent } from 'react';
import {
  defaultSiteTheme,
  THEME_PRESETS,
  type SiteThemeId,
} from '@forecourt/domain/site-theme';
import { updateWebsite } from '@/data/website-actions';
import type { WebsiteSettings } from '@/data/website';
import { LABEL_CLASS, INPUT_CLASS, BUTTON_CLASS } from '@/components/styles';

const THEMES = ['classic', 'studio', 'compact'] as const;

const FONTS = [
  ['inter', 'Inter'],
  ['source_sans', 'Source Sans'],
  ['ibm_plex', 'IBM Plex'],
  ['noto_sans', 'Noto Sans'],
  ['nunito_sans', 'Nunito Sans'],
  ['work_sans', 'Work Sans'],
] as const;

export function WebsiteForm({ settings, previews }: { settings: WebsiteSettings; previews: string[] }) {
  const [themeId, setThemeId] = useState<SiteThemeId>(settings.themeId);
  const [weeklyHours, setWeeklyHours] = useState(settings.weeklyHours);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await updateWebsite(data);
      if (!result.ok) setError(result.error);
      else setSaved(true);
    } catch {
      setError(
        'The website could not be saved. Your changes are still here; please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      onChange={() => setSaved(false)}
      className="grid gap-6"
    >
      <nav aria-label="Website sections" className="flex flex-wrap gap-2">
        {[
          ['appearance', 'Appearance'],
          ['contact', 'Contact & hours'],
          ['content', 'Page content'],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex min-h-11 items-center rounded-md border border-edge px-4 hover:bg-surface-3"
          >
            {label}
          </a>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-critical/40 p-3 text-critical"
        >
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="rounded-md border border-good/40 bg-surface-3 p-3 text-ink-muted"
        >
          Website saved. Open the preview to check your changes. Public pages
          may take up to five minutes to refresh.
        </p>
      )}

      <fieldset
        disabled={pending}
        id="appearance"
        className="grid scroll-mt-6 gap-4 rounded-lg border border-edge p-5 sm:grid-cols-2"
      >
        <legend className="mb-1 font-medium">Appearance</legend>
        <div className="sm:col-span-2">
          <h2 className="text-xl font-semibold tracking-tight">Find your showroom’s style</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">Three complete designs, shown with your current cars and website copy. Preview a layout, choose your favourite, then save your website.</p>
          <input type="hidden" name="themeId" value={themeId} />
          <div className="mt-6 grid gap-5 xl:grid-cols-3">
            {THEMES.map((id, index) => <article key={id} className={`min-w-0 overflow-hidden rounded-lg border ${themeId === id ? 'border-brand-600 ring-1 ring-brand-600' : 'border-edge'} bg-surface-1`}>
              <div aria-hidden="true" className="pointer-events-none relative h-52 overflow-hidden border-b border-edge bg-surface-3">
                <iframe title={`${THEME_PRESETS[id].label} thumbnail`} tabIndex={-1} loading="lazy" sandbox="" srcDoc={previews[index]?.replace(/<body(?=[ >])/, '<body inert')} style={{width:'357.143%',height:760,transform:'scale(.28)',transformOrigin:'top left',border:0}} />
              </div>
              <div className="grid gap-3 p-5">
                <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-semibold">{THEME_PRESETS[id].label}</h3>{themeId === id && <span className="text-xs font-medium text-link">✓ Selected</span>}</div>
                <p className="min-h-16 text-sm text-ink-muted">{THEME_PRESETS[id].description}</p>
                <a href={`/settings/website/preview?theme=${id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-md border border-edge-strong px-3 text-sm font-medium">Preview full website ↗</a>
                <button type="button" aria-pressed={themeId === id} className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700" onClick={event => {
                  setThemeId(id); setSaved(false);
                  const preset = defaultSiteTheme(id);
                  for (const key of ['brandPrimary', 'fontPairing', 'radius', 'cardStyle'] as const) {
                    const field = event.currentTarget.form?.elements.namedItem(key);
                    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = preset[key];
                  }
                }}>{themeId === id ? 'Theme selected' : 'Use this theme'}</button>
              </div>
            </article>)}
          </div>
          <p className="mt-5 text-sm text-ink-muted">Personalise the selected theme below. Your contact details, page copy and cars stay with you when you switch.</p>
        </div>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Brand colour</span>
          <input
            className={INPUT_CLASS}
            name="brandPrimary"
            defaultValue={settings.brandPrimary}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Type</span>
          <select
            className={INPUT_CLASS}
            name="fontPairing"
            defaultValue={settings.fontPairing}
          >
            {FONTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Corners</span>
          <select
            className={INPUT_CLASS}
            name="radius"
            defaultValue={settings.radius}
          >
            <option value="sharp">Sharp</option>
            <option value="soft">Soft</option>
            <option value="rounded">Rounded</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Cards</span>
          <select
            className={INPUT_CLASS}
            name="cardStyle"
            defaultValue={settings.cardStyle}
          >
            <option value="bordered">Bordered</option>
            <option value="elevated">Elevated</option>
            <option value="flat">Flat</option>
          </select>
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className={LABEL_CLASS}>Logo</span>
          {settings.logoUrl && (
            <img src={settings.logoUrl} alt="" className="mb-2 h-12 w-auto" />
          )}
          <input
            className={INPUT_CLASS}
            name="logo"
            type="file"
            accept="image/*"
          />
        </label>
      </fieldset>

      <fieldset
        disabled={pending}
        id="contact"
        className="grid scroll-mt-6 gap-4 rounded-lg border border-edge p-5 sm:grid-cols-2"
      >
        <legend className="mb-1 font-medium">Contact</legend>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Phone</span>
          <input
            className={INPUT_CLASS}
            name="phone"
            maxLength={40}
            defaultValue={settings.phone}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Email</span>
          <input
            className={INPUT_CLASS}
            name="email"
            maxLength={254}
            type="email"
            defaultValue={settings.email}
          />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className={LABEL_CLASS}>Address</span>
          <input
            className={INPUT_CLASS}
            name="line1"
            maxLength={200}
            defaultValue={settings.line1}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Town</span>
          <input
            className={INPUT_CLASS}
            name="city"
            maxLength={100}
            defaultValue={settings.city}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>County</span>
          <input
            className={INPUT_CLASS}
            name="county"
            maxLength={100}
            defaultValue={settings.county}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Postcode</span>
          <input
            className={INPUT_CLASS}
            name="postcode"
            maxLength={12}
            defaultValue={settings.postcode}
          />
        </label>
      </fieldset>

      <fieldset
        disabled={pending}
        className="grid gap-4 rounded-lg border border-edge p-5"
      >
        <legend className="mb-1 font-medium">Weekly opening hours</legend>
        <input type="hidden" name="hoursMode" value="weekly" />
        <p className="text-sm text-ink-muted">
          Times are local to the UK. Set one opening period per day; choose
          Closed when visitors cannot attend. Holiday exceptions and overnight
          hours are not supported yet.
        </p>
        {weeklyHours.map((hours, index) => (
          <fieldset
            key={hours.day}
            className="grid min-w-0 gap-3 border-b border-edge pb-4 sm:grid-cols-3"
          >
            <legend className="mb-2 font-medium">{hours.day}</legend>
            <label className="grid min-w-0 gap-1">
              <span className={LABEL_CLASS}>{hours.day} availability</span>
              <select
                className={INPUT_CLASS}
                name={`${hours.day}Status`}
                value={hours.open ? 'open' : 'closed'}
                onChange={(event) => {
                  const open = event.currentTarget.value === 'open';
                  setWeeklyHours((current) =>
                    current.map((entry, i) =>
                      i === index ? { ...entry, open } : entry,
                    ),
                  );
                }}
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1">
              <span className={LABEL_CLASS}>{hours.day} opens</span>
              <input
                className={`${INPUT_CLASS} min-w-0 w-full disabled:opacity-50`}
                name={`${hours.day}Open`}
                type="time"
                required={hours.open}
                disabled={!hours.open}
                defaultValue={hours.opens}
              />
            </label>
            <label className="grid min-w-0 gap-1">
              <span className={LABEL_CLASS}>{hours.day} closes</span>
              <input
                className={`${INPUT_CLASS} min-w-0 w-full disabled:opacity-50`}
                name={`${hours.day}Close`}
                type="time"
                required={hours.open}
                disabled={!hours.open}
                defaultValue={hours.closes}
              />
            </label>
          </fieldset>
        ))}
      </fieldset>

      <fieldset
        disabled={pending}
        id="content"
        className="grid scroll-mt-6 gap-4 rounded-lg border border-edge p-5"
      >
        <legend className="mb-1 font-medium">Page content</legend>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Home headline</span>
          <input
            className={INPUT_CLASS}
            name="homeHeadline"
            maxLength={160}
            defaultValue={settings.homeHeadline}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Home supporting line</span>
          <textarea
            className={INPUT_CLASS}
            name="homeLead"
            maxLength={600}
            rows={3}
            defaultValue={settings.homeLead}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>About</span>
          <textarea
            className={INPUT_CLASS}
            name="about"
            maxLength={10000}
            rows={5}
            defaultValue={settings.about}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Contact blurb</span>
          <textarea
            className={INPUT_CLASS}
            name="contactBlurb"
            maxLength={2000}
            rows={3}
            defaultValue={settings.contactBlurb}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Footer legal extras</span>
          <textarea
            className={INPUT_CLASS}
            name="footerLegal"
            maxLength={4000}
            rows={2}
            defaultValue={settings.footerLegal}
          />
        </label>
      </fieldset>

      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge-strong bg-surface-1 p-4 shadow-sm">
        <p className="hidden text-sm text-ink-muted sm:block">
          Changes apply to your public website when saved.
        </p>
        <button
          type="submit"
          disabled={pending}
          className={`${BUTTON_CLASS} border-brand-600 bg-brand-600 text-white`}
        >
          {pending ? 'Saving…' : 'Save website'}
        </button>
      </div>
    </form>
  );
}
