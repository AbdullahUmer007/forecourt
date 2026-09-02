'use client';

import { useState } from 'react';
import { changeStaffStatus } from '@/data/staff-actions';
import { INPUT_CLASS, BUTTON_CLASS } from './styles';

export function StaffRemove({ membershipId }: { membershipId: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    if (confirm !== 'REMOVE') {
      setError('Type REMOVE to confirm. Their login here ends; the person is not deleted.');
      return;
    }
    const result = await changeStaffStatus(formData);
    if (!result.ok) setError(result.error);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-3 text-critical">
        Remove
      </button>
    );
  }

  return (
    <form action={onSubmit} className="grid gap-2">
      {error && <p className="text-critical">{error}</p>}
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="status" value="removed" />
      <input
        className={INPUT_CLASS}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="REMOVE"
      />
      <button type="submit" className={`${BUTTON_CLASS} border-critical text-critical`}>
        Confirm remove
      </button>
    </form>
  );
}
