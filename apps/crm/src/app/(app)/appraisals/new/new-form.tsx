'use client';

import { useState } from 'react';
import { createAppraisal } from '@/data/appraisal-actions';
import { LABEL_CLASS, INPUT_CLASS, BUTTON_CLASS } from '@/components/styles';

export function NewAppraisalForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createAppraisal(formData);
    if (!result.ok) setError(result.error);
    setPending(false);
  }

  return (
    <form action={onSubmit} className="grid gap-3 sm:grid-cols-2">
      {error && <p className="sm:col-span-2 text-critical">{error}</p>}
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Registration</span>
        <input className={`${INPUT_CLASS} mono uppercase`} name="registration" required />
      </label>
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Mileage</span>
        <input className={INPUT_CLASS} name="mileage" type="number" min="0" required />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={LABEL_CLASS}>Seller</span>
        <select className={INPUT_CLASS} name="sellerType" defaultValue="private_individual">
          <option value="private_individual">Private individual</option>
          <option value="vat_registered_business">VAT-registered business</option>
          <option value="non_vat_business">Unregistered business</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Contact name</span>
        <input className={INPUT_CLASS} name="name" />
      </label>
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Phone</span>
        <input className={INPUT_CLASS} name="phone" />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={LABEL_CLASS}>Email</span>
        <input className={INPUT_CLASS} name="email" type="email" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className={`${BUTTON_CLASS} border-brand-600 bg-brand-600 text-white sm:col-span-2`}
      >
        {pending ? 'Saving…' : 'Start appraisal'}
      </button>
    </form>
  );
}
