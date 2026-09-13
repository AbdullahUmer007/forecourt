'use client';

import { useEffect, useState } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { transitionVehicle } from '@/data/vehicle-actions';
import { withdrawVehicle } from '@/data/withdraw-actions';
import { BUTTON_CLASS } from './styles';

export function VehicleLifecycle(
  {
    vehicleId, state, canArchive, blockers, actions,
  }: {
    vehicleId: string;
    state: string;
    canArchive: boolean;
    blockers: { code: string; message: string }[];
    actions: { label: string; toState: string }[];
  },
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  useEffect(() => { setError(null); }, [state, blockers.length]);

  async function move(toState: string) {
    setError(null);
    const data = new FormData();
    data.set('vehicleId', vehicleId);
    data.set('toState', toState);
    setPending(true);
    try { const result = await transitionVehicle(null, data); if (!result.ok) setError(result.error); }
    catch { setError('The vehicle status could not be changed. Please try again.'); }
    finally { setPending(false); }
  }

  async function archive() {
    setError(null);
    const data = new FormData();
    data.set('vehicleId', vehicleId);
    data.set('confirm', confirm);
    setPending(true);
    try { const result = await withdrawVehicle(data); if (!result.ok) setError(result.error); }
    catch (error) { unstable_rethrow(error); setError('The vehicle could not be archived. Please try again.'); }
    finally { setPending(false); }
  }

  const sold = state === 'sold' || state === 'delivered';

  return (
    <fieldset disabled={pending} className="grid min-w-0 gap-3">
      {error && <p role="alert" className="text-critical">{error}</p>}

      {state !== 'live' && blockers.length > 0 && (
        <ul className="list-disc pl-5 text-[13px] text-ink-muted">
          {blockers.map((b) => <li key={b.code}>{b.message}</li>)}
        </ul>
      )}

      {actions.map((a) => (
        <button
          key={a.toState + a.label}
          type="button"
          onClick={() => move(a.toState)}
          className={`${BUTTON_CLASS} ${
            a.toState === 'live'
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-edge-strong'
          }`}
        >
          {a.label}
        </button>
      ))}

      {state !== 'archived' && !sold && canArchive && (
        <div className="rounded-md border border-edge p-3">
          <p className="mb-2 text-[13px] text-ink-muted">
            Archive withdraws the car from stock. Type ARCHIVE to confirm.
            Invoices and the stock book are not touched.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="min-h-11 rounded-md border border-edge-strong px-3"
              placeholder="ARCHIVE"
              aria-label="Type ARCHIVE to confirm"
            />
            <button type="button" onClick={archive} className={`${BUTTON_CLASS} border-critical text-critical`}>
              Archive
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
