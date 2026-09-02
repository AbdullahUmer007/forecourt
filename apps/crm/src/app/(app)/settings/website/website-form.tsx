'use client';

import { useState } from 'react';
import { updateWebsite } from '@/data/website-actions';
import type { WebsiteSettings } from '@/data/website';
import { LABEL_CLASS, INPUT_CLASS, BUTTON_CLASS } from '@/components/styles';

const THEMES = [
  ['classic', 'Classic — traditional and trustworthy'],
  ['studio', 'Studio — editorial, photography-led'],
  ['compact', 'Compact — dense listings, value-focused'],
] as const;

const FONTS = [
  ['inter', 'Inter'],
  ['source_sans', 'Source Sans'],
  ['ibm_plex', 'IBM Plex'],
  ['noto_sans', 'Noto Sans'],
  ['nunito_sans', 'Nunito Sans'],
  ['work_sans', 'Work Sans'],
] as const;

export function WebsiteForm({ settings }: { settings: WebsiteSettings }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateWebsite(formData);
    if (!result.ok) setError(result.error);
    else setSaved(true);
    setPending(false);
  }

  return (
    <form action={onSubmit} className="grid gap-4">
      {error && <p className="rounded-md border border-critical/40 p-3 text-critical">{error}</p>}
      {saved && (
        <p role="status" className="rounded-md border border-good/40 bg-surface-3 p-3 text-ink-muted">
          Saved. Preview to see it as a buyer would.
        </p>
      )}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-medium">Look</legend>
        <label className="grid gap-1 sm:col-span-2">
          <span className={LABEL_CLASS}>Theme</span>
          <select className={INPUT_CLASS} name="themeId" defaultValue={settings.themeId}>
            {THEMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Brand colour</span>
          <input className={INPUT_CLASS} name="brandPrimary" defaultValue={settings.brandPrimary} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Type</span>
          <select className={INPUT_CLASS} name="fontPairing" defaultValue={settings.fontPairing}>
            {FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Corners</span>
          <select className={INPUT_CLASS} name="radius" defaultValue={settings.radius}>
            <option value="sharp">Sharp</option>
            <option value="soft">Soft</option>
            <option value="rounded">Rounded</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Cards</span>
          <select className={INPUT_CLASS} name="cardStyle" defaultValue={settings.cardStyle}>
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
          <input className={INPUT_CLASS} name="logo" type="file" accept="image/*" />
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-medium">Contact</legend>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Phone</span>
          <input className={INPUT_CLASS} name="phone" defaultValue={settings.phone} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Email</span>
          <input className={INPUT_CLASS} name="email" type="email" defaultValue={settings.email} />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className={LABEL_CLASS}>Address</span>
          <input className={INPUT_CLASS} name="line1" defaultValue={settings.line1} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Town</span>
          <input className={INPUT_CLASS} name="city" defaultValue={settings.city} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>County</span>
          <input className={INPUT_CLASS} name="county" defaultValue={settings.county} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Postcode</span>
          <input className={INPUT_CLASS} name="postcode" defaultValue={settings.postcode} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Weekdays open</span>
          <input className={INPUT_CLASS} name="weekdayOpen" defaultValue={settings.weekdayOpen} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Weekdays close</span>
          <input className={INPUT_CLASS} name="weekdayClose" defaultValue={settings.weekdayClose} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Saturday open</span>
          <input className={INPUT_CLASS} name="saturdayOpen" defaultValue={settings.saturdayOpen} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Saturday close</span>
          <input className={INPUT_CLASS} name="saturdayClose" defaultValue={settings.saturdayClose} />
        </label>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-medium">Copy</legend>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Home headline</span>
          <input className={INPUT_CLASS} name="homeHeadline" defaultValue={settings.homeHeadline} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Home supporting line</span>
          <textarea className={INPUT_CLASS} name="homeLead" rows={3} defaultValue={settings.homeLead} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>About</span>
          <textarea className={INPUT_CLASS} name="about" rows={5} defaultValue={settings.about} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Contact blurb</span>
          <textarea className={INPUT_CLASS} name="contactBlurb" rows={3} defaultValue={settings.contactBlurb} />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Footer legal extras</span>
          <textarea className={INPUT_CLASS} name="footerLegal" rows={2} defaultValue={settings.footerLegal} />
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className={`${BUTTON_CLASS} border-brand-600 bg-brand-600 text-white`}
      >
        {pending ? 'Saving…' : 'Save website'}
      </button>
    </form>
  );
}
