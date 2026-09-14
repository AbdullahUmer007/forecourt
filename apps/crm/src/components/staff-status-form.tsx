'use client';

import { useState } from 'react';
import { changeStaffStatus } from '@/data/staff-actions';

/** Keep the browser handler on the client; only the exported server action crosses the RSC boundary. */
export function StaffStatusForm({ membershipId, status }: { membershipId: string; status: 'active' | 'suspended' }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(data: FormData) {
    if (pending) return;
    setPending(true); setError(null);
    try {
      const result = await changeStaffStatus(data);
      if (!result.ok) setError(result.error);
    } catch {
      setError('This change could not be saved. Refresh the page and try again.');
    } finally { setPending(false); }
  }
  return <form action={submit} className="grid gap-1">
    <input type="hidden" name="membershipId" value={membershipId} />
    <input type="hidden" name="status" value={status} />
    <button disabled={pending} className="min-h-11 rounded-md px-3 text-ink-muted hover:text-ink disabled:opacity-50">
      {pending ? 'Saving…' : status === 'suspended' ? 'Suspend' : 'Restore'}
    </button>
    {error && <p role="alert" className="max-w-xs text-sm text-critical">{error}</p>}
  </form>;
}
