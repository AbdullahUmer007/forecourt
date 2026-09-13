import Link from 'next/link';
import { notFound } from 'next/navigation';
import { holds } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import { loadAppointments, ukDate } from '@/data/appointments';
import { Card, PageHeader, StatusBadge } from '@/components/ui';
export const metadata = { title: 'Appointments' };
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!holds(session, 'lead.read')) notFound();
  const p = await searchParams,
    mine = p['mine'] === '1',
    { date, rows } = await loadAppointments(
      session,
      p['date'] ?? ukDate(),
      mine,
    );
  const shift = (n: number) => {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return `/appointments?date=${d.toISOString().slice(0, 10)}${mine ? '&mine=1' : ''}`;
  };
  const scheduled = rows.filter((a) => a.status === 'scheduled').length;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Appointments"
        meta="A clear plan for every viewing, test drive and collection."
        action={
          holds(session, 'lead.update') &&
          holds(session, 'contact.read') && (
            <Link
              href="/appointments/new"
              className="inline-flex min-h-11 items-center rounded-md bg-brand-600 px-4 text-white"
            >
              Book appointment
            </Link>
          )
        }
      />
      <Card>
        <form method="GET" className="flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm">
            Day (UK time)
            <input
              type="date"
              name="date"
              defaultValue={date}
              required
              className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="mine"
              value="1"
              defaultChecked={mine}
            />
            My appointments only
          </label>
          <button className="min-h-11 rounded-md border border-edge-strong px-4">
            Show day
          </button>
          <Link
            href="/appointments"
            className="inline-flex min-h-11 items-center text-sm text-link"
          >
            Today
          </Link>
        </form>
      </Card>
      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'Europe/London',
            })}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {scheduled} scheduled · {rows.length - scheduled} closed
          </p>
        </div>
        <nav aria-label="Diary days" className="flex gap-4 text-sm text-link">
          <Link className="py-3" href={shift(-1)}>
            ← Previous day
          </Link>
          <Link className="py-3" href={shift(1)}>
            Next day →
          </Link>
        </nav>
      </div>
      <div className="space-y-3">
        {rows.map((a) => (
          <Link
            key={a.id}
            href={`/appointments/${a.id}`}
            className="flex flex-wrap items-center gap-5 rounded-lg border border-edge bg-surface-1 p-5 hover:border-edge-strong"
          >
            <div className="w-24 shrink-0">
              <span className="block text-xl font-semibold tabular-nums">
                {new Date(a.startsAt).toLocaleTimeString('en-GB', {
                  timeZone: 'Europe/London',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="text-xs text-ink-muted">
                {Math.round(
                  (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000,
                )}{' '}
                minutes
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <span className="block font-semibold break-words">
                {a.customer}
              </span>
              <span className="block text-sm capitalize text-ink-muted">
                {a.purpose.replaceAll('_', ' ')} · {a.staff}
              </span>
              <span className="block text-xs text-ink-muted">{a.site}</span>
            </div>
            <StatusBadge
              tone={
                a.status === 'scheduled'
                  ? 'info'
                  : a.status === 'completed'
                    ? 'good'
                    : 'neutral'
              }
              icon={a.status === 'completed' ? '✓' : '○'}
              label={a.status.replaceAll('_', ' ')}
            />
          </Link>
        ))}
        {!rows.length && (
          <Card>
            <div className="py-14 text-center">
              <p className="text-xl font-semibold">A clear diary</p>
              <p className="mt-2 text-ink-muted">
                No appointments for this day{mine ? ' assigned to you' : ''}.
                Choose another day or book a customer visit.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
