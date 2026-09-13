import Link from 'next/link';
import { notFound } from 'next/navigation';
import { holds } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import {
  loadAppointment,
  appointmentOptions,
  appointmentStamp,
  ukDate,
} from '@/data/appointments';
import { AppointmentForm } from '@/components/appointment-form';
import { Card, PageHeader, StatusBadge } from '@/components/ui';
export const metadata = { title: 'Appointment details' };
export default async function AppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession(),
    a = await loadAppointment(session, (await params).id);
  if (!a) notFound();
  const options = await appointmentOptions(session),
    editable =
      holds(session, 'lead.update') &&
      (session.scope !== 'own_records' || a.assignedTo === session.userId) &&
      a.status === 'scheduled';
  const shared = {
    appointment: a,
    contactId: a.contactId,
    siteId: a.siteId,
    userId: session.userId,
    ...options,
  };
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/appointments?date=${ukDate(new Date(a.startsAt))}`}
        className="mb-4 inline-flex min-h-11 items-center text-link"
      >
        ← Day diary
      </Link>
      <PageHeader
        title={a.customer}
        meta={`${a.purpose.replaceAll('_', ' ')} · ${appointmentStamp(a.startsAt)} (UK)`}
        action={
          <StatusBadge
            tone={a.status === 'scheduled' ? 'info' : 'neutral'}
            icon="○"
            label={a.status.replaceAll('_', ' ')}
          />
        }
      />
      <div className="mb-5 flex flex-wrap gap-5 text-sm text-link">
        {holds(session, 'contact.read') && (
          <Link href={`/customers/${a.contactId}`}>Customer profile →</Link>
        )}
        {a.leadId && <Link href={`/leads/${a.leadId}`}>Related enquiry →</Link>}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title={editable ? 'Appointment details' : 'Visit details'}>
          {editable ? (
            <AppointmentForm key={a.id} {...shared} />
          ) : (
            <dl className="space-y-4">
              <div>
                <dt className="text-sm text-ink-muted">Staff member</dt>
                <dd>{a.staff}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-muted">Location</dt>
                <dd>{a.site}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-muted">Preparation notes</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {a.notes || 'None recorded'}
                </dd>
              </div>
            </dl>
          )}
        </Card>
        <Card title={editable ? 'Close the appointment' : 'Outcome'}>
          {editable ? (
            <>
              <p className="mb-4 text-sm text-ink-muted">
                Record what happened after the visit, or cancel with a reason.
                The history stays on the customer profile.
              </p>
              <AppointmentForm key={`close-${a.version}`} {...shared} closing />
            </>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm">
              {a.outcome || 'This appointment is still scheduled.'}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
