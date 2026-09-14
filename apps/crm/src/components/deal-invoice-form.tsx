'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { draftInvoiceFromDeal } from '@/data/invoice-actions';
import { primary } from './customer-form';
export function DealInvoiceForm({
  dealId,
  revision,
}: {
  dealId: string;
  revision: string;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError('');
    try {
      const r = await draftInvoiceFromDeal(form);
      if (r.ok && r.invoiceId) router.push(`/invoices/${r.invoiceId}`);
      else
        setError(
          r.error ??
            'The invoice could not be prepared. Refresh and try again.',
        );
    } catch {
      setError(
        'Unable to prepare the draft. Check the deal details and try again.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="revision" value={revision} />
      {error && (
        <p role="alert" className="rounded-md border border-edge-strong p-4">
          {error}
        </p>
      )}
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" required className="mt-1 h-5 w-5" />I have
        checked the customer, vehicle and cash price.
      </label>
      <button type="submit" className={primary} disabled={pending}>
        {pending ? 'Preparing…' : 'Create invoice draft'}
      </button>
    </form>
  );
}
