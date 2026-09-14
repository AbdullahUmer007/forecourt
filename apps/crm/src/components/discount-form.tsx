'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { submitDiscount } from '@/data/discount-actions';
import { primary, control } from './customer-form';
export function DiscountForm({
  id,
  binding,
  sequence,
  review = false,
}: {
  id: string;
  binding: string;
  sequence: number | null;
  review?: boolean;
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
      const r = await submitDiscount(data);
      if (r.ok) router.refresh();
      else setError(r.error);
    } catch {
      setError('The discount could not be saved. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="binding" value={binding} />
      <input type="hidden" name="sequence" value={sequence ?? ''} />
      {review ? (
        <label className="grid gap-2">
          Decision
          <select name="action" className={control}>
            <option value="approved">Approve discount</option>
            <option value="declined">Decline discount</option>
          </select>
        </label>
      ) : (
        <input type="hidden" name="action" value="request" />
      )}
      <label className="grid gap-2">
        {review ? 'Decision reason' : 'Why is a discount needed?'}
        <textarea
          className={control}
          name="reason"
          minLength={5}
          maxLength={1000}
          required
          rows={3}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending} className={primary}>
        {pending ? 'Saving…' : review ? 'Save decision' : 'Request approval'}
      </button>
    </form>
  );
}
