'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createDraftDeal, updateDraftPrice } from '@/data/deal-actions';
import { control, primary } from './customer-form';
export function DealBuilderForm({
  contacts,
  vehicles,
  contactId = '',
  vehicleId = '',
  leadId = '',
}: {
  contacts: { id: string; label: string }[];
  vehicles: { id: string; label: string; price: string }[];
  contactId?: string;
  vehicleId?: string;
  leadId?: string;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [price, setPrice] = useState(
    vehicles.find((v) => v.id === vehicleId)?.price ?? '',
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setError('');
    try {
      const r = await createDraftDeal(data);
      if (r.ok) router.push(`/deals/${r.id}`);
      else setError(r.error);
    } catch {
      setError(
        'The deal could not be saved. Your entries are still here; please try again.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <input type="hidden" name="leadId" value={leadId} />
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-edge-strong bg-surface-3 p-4"
        >
          {error}
        </p>
      )}
      <fieldset disabled={pending} className="grid gap-5">
        <legend className="sr-only">Draft deal details</legend>
        <label className="grid gap-2 text-sm font-medium">
          Customer
          <select
            className={control}
            name="contactId"
            defaultValue={contactId}
            required
          >
            <option value="">Choose a customer</option>
            {contacts.map((c) => (
              <option value={c.id} key={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Vehicle
          <select
            className={control}
            name="vehicleId"
            defaultValue={vehicleId}
            required
            onChange={(e) =>
              setPrice(
                vehicles.find((v) => v.id === e.target.value)?.price ?? '',
              )
            }
          >
            <option value="">Choose a car</option>
            {vehicles.map((v) => (
              <option value={v.id} key={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Cash price (£)
          <input
            className={control}
            name="price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            aria-describedby="cash-help"
          />
          <span id="cash-help" className="font-normal text-ink-muted">
            Starts with the advertised price. Confirm the amount before creating
            the draft.
          </span>
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4 border-t border-edge pt-5">
        <button className={primary} disabled={pending} type="submit">
          {pending ? 'Creating draft…' : 'Create draft deal'}
        </button>
        <p className="text-sm text-ink-muted">
          You can review the deal before moving it forward.
        </p>
      </div>
    </form>
  );
}

export function DraftPriceForm({
  id,
  price,
  revision,
}: {
  id: string;
  price: string;
  revision: string;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setMessage('');
    try {
      const r = await updateDraftPrice(data);
      setError(!r.ok);
      setMessage(r.ok ? 'Draft cash price saved.' : r.error);
      if (r.ok) router.refresh();
    } catch {
      setError(true);
      setMessage('The price could not be saved. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <label className="grid gap-2 text-sm font-medium">
        Draft cash price (£)
        <input
          name="price"
          className={control}
          inputMode="decimal"
          defaultValue={price}
          required
          disabled={pending}
        />
      </label>
      {message && (
        <p role={error ? 'alert' : 'status'} className="text-sm">
          {message}
        </p>
      )}
      <button className={primary} disabled={pending} type="submit">
        {pending ? 'Saving…' : 'Save draft price'}
      </button>
      <p className="text-sm text-ink-muted">
        Price changes stay in the deal history. Available while this deal is an
        uninvoiced draft.
      </p>
    </form>
  );
}
