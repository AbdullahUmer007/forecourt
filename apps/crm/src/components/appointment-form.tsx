'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { saveAppointment } from '@/data/customer-actions';
import type { Appointment } from '@/data/appointments';
import type { CustomerOutcome } from '@/data/customers';
import { control, primary } from './customer-form';
export function AppointmentForm({
  appointment,
  contactId,
  leadId = '',
  siteId,
  userId,
  sites,
  people,
  closing = false,
}: {
  appointment?: Appointment;
  contactId: string;
  leadId?: string;
  siteId: string;
  userId: string;
  sites: { id: string; name: string }[];
  people: { id: string; name: string }[];
  closing?: boolean;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [result, setResult] = useState<CustomerOutcome | null>(null);
  // Explicit UK local entry avoids changing the appointment when the user's computer is abroad.
  const local = appointment
    ? new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(new Date(appointment.startsAt))
        .replace(' ', 'T')
    : '';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setResult(null);
    try {
      const r = await saveAppointment(data);
      setResult(r);
      if (r.ok) {
        if (!appointment) router.push(`/appointments/${r.id}`);
        else router.refresh();
      }
    } catch {
      setResult({
        ok: false,
        error: 'Unable to save. Your entries are still here; please try again.',
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {Object.entries({
        id: appointment?.id ?? '',
        version: String(appointment?.version ?? 0),
        contactId,
        leadId: appointment?.leadId ?? leadId,
      }).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        {closing ? (
          <>
            <label className="grid content-start gap-1 text-sm sm:col-span-2">
              Outcome
              <select name="operation" className={control}>
                <option value="completed">Completed</option>
                <option value="no_show">Did not attend</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="grid content-start gap-1 text-sm sm:col-span-2">
              Outcome notes or cancellation reason
              <textarea
                name="outcome"
                required
                maxLength={2000}
                rows={3}
                className={control}
              />
            </label>
          </>
        ) : (
          <>
            <input type="hidden" name="operation" value="save" />
            <label className="grid content-start gap-1 text-sm">
              Appointment type
              <select
                name="purpose"
                defaultValue={appointment?.purpose ?? 'viewing'}
                className={control}
              >
                <option value="viewing">Vehicle viewing</option>
                <option value="test_drive">Test drive</option>
                <option value="collection">Vehicle collection</option>
                <option value="meeting">Customer meeting</option>
              </select>
            </label>
            <label className="grid content-start gap-1 text-sm">
              Staff member
              <select
                name="assignedTo"
                required
                defaultValue={appointment?.assignedTo ?? userId}
                className={control}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid content-start gap-1 text-sm">
              Date and time (UK)
              <input
                type="datetime-local"
                name="localStart"
                required
                defaultValue={local}
                className={control}
              />
              <span className="text-xs text-ink-muted">
                Europe/London · GMT or BST as applicable
              </span>
            </label>
            <label className="grid content-start gap-1 text-sm">
              Duration
              <select
                name="duration"
                defaultValue={
                  appointment
                    ? String(
                        (Date.parse(appointment.endsAt) -
                          Date.parse(appointment.startsAt)) /
                          60000,
                      )
                    : '60'
                }
                className={control}
              >
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className="grid content-start gap-1 text-sm sm:col-span-2">
              Dealership site
              <select
                name="siteId"
                required
                defaultValue={appointment?.siteId ?? siteId}
                className={control}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid content-start gap-1 text-sm sm:col-span-2">
              Preparation notes
              <textarea
                name="notes"
                rows={3}
                maxLength={2000}
                defaultValue={appointment?.notes ?? ''}
                className={control}
                placeholder="Vehicle of interest, access needs or anything to prepare"
              />
            </label>
          </>
        )}
      </fieldset>
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={result.ok ? 'text-good' : 'text-critical'}
        >
          {result.message ?? result.error}
        </p>
      )}
      <button
        disabled={pending}
        className={
          closing
            ? 'inline-flex min-h-11 items-center rounded-md border border-edge-strong px-4 font-medium disabled:opacity-50'
            : primary
        }
      >
        {pending
          ? 'Saving…'
          : closing
            ? 'Record outcome'
            : appointment
              ? 'Save appointment'
              : 'Book appointment'}
      </button>
    </form>
  );
}
