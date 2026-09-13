'use client';

import { useState } from 'react';
import { StockPhoto } from './stock-photo';
import { uploadVehiclePhoto, manageVehiclePhoto } from '@/data/media-actions';
import type { VehiclePhoto } from '@/data/media-apply';
import { LABEL_CLASS, INPUT_CLASS, BUTTON_CLASS } from './styles';

const SHOTS = [
  ['front_three_quarter', 'Front three-quarter'],
  ['nearside', 'Nearside'],
  ['rear_three_quarter', 'Rear three-quarter'],
  ['interior_front', 'Front interior'],
  ['dashboard', 'Dashboard'],
  ['odometer', 'Odometer'],
  ['damage', 'Declared mark'],
  ['other', 'Other'],
] as const;

export function VehicleMediaPanel(
  { vehicleId, photos }: { vehicleId: string; photos: VehiclePhoto[] },
) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onUpload(formData: FormData) {
    setPending(true);
    setError(null);
    try { const result = await uploadVehiclePhoto(formData); if (!result.ok) setError(result.error); }
    catch { setError('The upload could not finish. Please try again.'); }
    finally { setPending(false); }
  }

  async function onManage(formData: FormData) {
    setError(null);
    setPending(true);
    try { const result = await manageVehiclePhoto(formData); if (!result.ok) setError(result.error); }
    catch { setError('The photograph could not be updated. Please try again.'); }
    finally { setPending(false); }
  }

  return (
    <fieldset disabled={pending} className="grid min-w-0 gap-4">
      <div className="rounded-lg bg-surface-3 p-4"><p className="font-semibold">Build a better first impression</p><p className="mt-1 text-[13px] text-ink-muted">Choose a cover photo, then add exterior, interior and detail shots. Published photographs appear on your vehicle listing.</p></div>
      {error && <p role="alert" className="text-critical">{error}</p>}

      {photos.length === 0 ? (
        <p className="text-ink-muted">
          No photographs yet. A car cannot go live without at least one published picture.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {photos.map((p) => (
            <li key={p.id} className="rounded-md border border-edge p-2">
              <StockPhoto url={p.url} description={p.shot.replace(/_/g, ' ')} />
              <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
                {p.isHero && <span className="font-medium">Hero</span>}
                <span className="text-ink-subtle">{p.published ? 'Published' : 'Unpublished'}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <form action={onManage}>
                  <input type="hidden" name="mediaId" value={p.id} />
                  <input type="hidden" name="vehicleId" value={vehicleId} />
                  {!p.isHero && (
                    <button name="action" value="hero" className="min-h-11 px-2 text-ink-muted hover:text-ink">
                      Make hero
                    </button>
                  )}
                  <button
                    disabled={p.published && p.isDisclosure && p.shownToBuyer}
                    name="action"
                    value={p.published ? 'unpublish' : 'publish'}
                    className="min-h-11 px-2 text-ink-muted hover:text-ink"
                  >
                    {p.published ? 'Unpublish' : 'Publish'}
                  </button>
                  {!(p.isDisclosure && p.shownToBuyer) && (
                    <button name="action" value="withdraw" className="min-h-11 px-2 text-critical">
                      Withdraw
                    </button>
                  )}
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={onUpload} className="grid gap-3 rounded-lg border border-dashed border-edge-strong bg-surface-2 p-4 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
        <input type="hidden" name="vehicleId" value={vehicleId} />
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Photograph</span>
          <input className={INPUT_CLASS} name="photo" type="file" accept="image/*" required />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>Shot</span>
          <select className={INPUT_CLASS} name="shot" defaultValue="front_three_quarter">
            {SHOTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`${BUTTON_CLASS} self-end border-brand-600 bg-brand-600 text-white`}
        >
          {pending ? 'Saving…' : 'Upload'}
        </button>
      </form>
    </fieldset>
  );
}
