'use client';

import { useState } from 'react';
import { invitePerson } from '@/data/staff-actions';
import type { StaffOutcome } from '@/data/staff';
import { LABEL_CLASS, INPUT_CLASS, BUTTON_CLASS } from '@/components/styles';

export function InviteForm({ roles }: { roles: { key: string; name: string }[] }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<StaffOutcome | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const outcome = await invitePerson(formData);
    setResult(outcome);
    setPending(false);
  }

  return (
    <form action={onSubmit} className="grid gap-3 sm:grid-cols-2">
      {result && !result.ok && (
        <p className="sm:col-span-2 rounded-md border border-critical/40 p-3 text-critical">{result.error}</p>
      )}
      {result?.ok && result.password && (
        <p className="sm:col-span-2 rounded-md border border-edge bg-surface-3 p-3">
          Login created for <strong>{result.email}</strong>. Password shown once:
          {' '}
          <code className="break-all">{result.password}</code>
        </p>
      )}
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Name</span>
        <input className={INPUT_CLASS} name="name" required />
      </label>
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Email</span>
        <input className={INPUT_CLASS} name="email" type="email" required />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={LABEL_CLASS}>Role</span>
        <select className={INPUT_CLASS} name="roleKey" required defaultValue="sales_executive">
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className={`${BUTTON_CLASS} border-brand-600 bg-brand-600 text-white sm:col-span-2`}
      >
        {pending ? 'Inviting…' : 'Add staff'}
      </button>
    </form>
  );
}
