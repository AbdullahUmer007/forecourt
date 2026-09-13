'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { saveCustomer } from '@/data/customer-actions';
import type { Customer, CustomerOutcome } from '@/data/customers';
export const control =
  'min-h-11 w-full rounded-md border border-edge-strong bg-surface-1 px-3 py-2 text-ink';
export const primary =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50';
export function CustomerForm({
  customer,
  sites,
  editable = true,
}: {
  customer?: Customer;
  sites: { id: string; name: string }[];
  editable?: boolean;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [result, setResult] = useState<CustomerOutcome | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setResult(null);
    try {
      const r = await saveCustomer(data);
      setResult(r);
      if (r.ok) {
        if (!customer) router.push(`/customers/${r.id}`);
        else router.refresh();
      }
    } catch {
      setResult({
        ok: false,
        error: 'Unable to save. Your details are still here; please try again.',
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <input type="hidden" name="id" value={customer?.id ?? ''} />
      <input type="hidden" name="revision" value={customer?.revision ?? ''} />
      <fieldset
        disabled={pending || !editable}
        className="grid gap-4 sm:grid-cols-2"
      >
        {!customer && (
          <label className="grid gap-1 text-sm sm:col-span-2">
            Dealership site
            <select name="siteId" required className={control}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(
          [
            ['firstName', 'First name', 100, 'text'],
            ['lastName', 'Last name', 100, 'text'],
            ['email', 'Email address', 254, 'email'],
            ['phone', 'Phone number', 40, 'tel'],
            ['address', 'Address', 200, 'text'],
            ['postcode', 'Postcode', 12, 'text'],
          ] as const
        ).map(([key, label, max, type]) => (
          <label key={key} className="grid gap-1 text-sm">
            {label}
            <input
              name={key}
              type={type}
              maxLength={max}
              defaultValue={customer?.[key] ?? ''}
              className={control}
            />
          </label>
        ))}
        <label className="grid gap-1 text-sm sm:col-span-2">
          Customer notes
          <textarea
            name="notes"
            maxLength={2000}
            rows={4}
            defaultValue={customer?.notes ?? ''}
            className={control}
          />
          <span className="text-xs text-ink-muted">
            Useful context for your team. Keep sensitive information out of
            general notes.
          </span>
        </label>
      </fieldset>
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={result.ok ? 'text-good' : 'text-critical'}
        >
          {result.message ?? result.error}
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
          <button disabled={pending} className={primary}>
            {pending
              ? 'Saving…'
              : customer
                ? 'Save customer'
                : 'Create customer'}
          </button>
          <span className="text-xs text-ink-muted">
            Contact details do not grant marketing permission.
          </span>
        </div>
      )}
    </form>
  );
}
