'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createCashQuote } from '@/data/cash-quote-actions';
import { primary } from './customer-form';
export function CashQuoteSave({
  id,
  revision,
}: {
  id: string;
  revision: string;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    setPending(true);
    setError('');
    try {
      const r = await createCashQuote(data);
      if (r.ok) {
        router.push(`/deals/${id}/quotes?version=${r.sequence}`);
        router.refresh();
      } else setError(r.error);
    } catch {
      setError(
        'Unable to save the quotation. Your deal is unchanged; try again.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="dealId" value={id} />
      <input type="hidden" name="revision" value={revision} />
      {error && <p role="alert">{error}</p>}
      <button className={primary} disabled={pending}>
        {pending ? 'Saving…' : 'Save quotation version'}
      </button>
    </form>
  );
}
export function PrintCashQuote() {
  return (
    <button className={primary} onClick={() => window.print()}>
      Print quotation
    </button>
  );
}
