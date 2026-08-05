import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadLead, loadAssignees } from '@/data/leads';
import { Card, StatusBadge, Row, Reg, Empty, type Tone } from '@/components/ui';
import { StageControl, ReopenControl, AssignControl, NoteControl } from '@/components/lead-controls';
import { holds, LOSS_REASON_LABELS, TERMINAL_STAGES, type LeadStage } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * One lead.
 *
 * Three things a salesperson needs before they pick up the phone: how long
 * this person has been waiting, what they asked about, and what we are
 * permitted to say to them. The third is the one every other CRM gets wrong —
 * either by not showing it at all, or by showing a single "opted out" flag
 * that makes staff afraid to answer an enquiry they are perfectly entitled to
 * answer. Replying to somebody's question is a service message; offering them
 * a different car is marketing. Both answers are shown, separately, computed
 * through the same gate the send job uses.
 */

const STAGE_PRESENTATION: Record<LeadStage, { tone: Tone; icon: string }> = {
  new: { tone: 'info', icon: '●' },
  contacted: { tone: 'info', icon: '☎' },
  qualified: { tone: 'info', icon: '✓' },
  appointment: { tone: 'info', icon: '⌚' },
  test_drive: { tone: 'info', icon: '⇢' },
  negotiating: { tone: 'warning', icon: '⇄' },
  won: { tone: 'good', icon: '£' },
  lost: { tone: 'neutral', icon: '✕' },
};

const CHANNEL_LABELS: Record<string, string> = {
  phone: 'Phone', email: 'Email', sms: 'Text', whatsapp: 'WhatsApp', post: 'Post',
};

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const stamp = (d: Date): string =>
  d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export default async function LeadPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const canUpdate = holds(principal, 'lead.update');

  const [lead, people] = await Promise.all([
    loadLead(session, id),
    loadAssignees(session),
  ]);
  if (!lead) notFound();

  const stage = STAGE_PRESENTATION[lead.stage];
  const closed = TERMINAL_STAGES.includes(lead.stage);
  const waiting = !closed && lead.firstResponseAt === null;

  // The conversation and the history, interleaved. Two lists side by side make
  // "we rang, then they emailed, then it was marked qualified" impossible to
  // read as the single sequence it actually was.
  const timeline = [
    ...lead.events.map((e) => ({
      at: e.occurredAt, kind: 'event' as const, event: e, message: null,
    })),
    ...lead.messages.map((m) => ({
      at: m.occurredAt, kind: 'message' as const, event: null, message: m,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-4">
        <Card>
          <Link href="/leads" className="text-[13px] leading-[18px] text-brand-700 hover:underline">
            ← Leads
          </Link>

          <h1 className="mt-2 text-[20px] leading-7 font-semibold">{lead.contactName}</h1>
          <p className="text-ink-subtle">
            {label(lead.source)} · received {stamp(lead.receivedAt)}
            {lead.siteName && ` · ${lead.siteName}`}
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge tone={stage.tone} icon={stage.icon} label={label(lead.stage)} />

            {waiting && (
              <StatusBadge
                tone={lead.sla.breached ? 'critical' : lead.sla.minutesRemaining <= 5 ? 'warning' : 'info'}
                icon={lead.sla.breached ? '!' : '⏱'}
                label={lead.dueAt
                  ? `${lead.sla.label} · due ${stamp(lead.dueAt)}`
                  : lead.sla.label}
              />
            )}

            {lead.firstResponseAt !== null && (
              <StatusBadge
                tone={lead.sla.breached ? 'warning' : 'good'}
                icon={lead.sla.breached ? '!' : '✓'}
                label={lead.sla.label}
              />
            )}

            {lead.lossReason && (
              <StatusBadge tone="neutral" icon="✕" label={LOSS_REASON_LABELS[lead.lossReason]} />
            )}
          </div>

          {/* The clock is measured from the first OUTBOUND message, not from a
              button. Saying so on the screen matters: otherwise somebody will
              go looking for the "mark as contacted" control and conclude the
              CRM is broken. */}
          {waiting && (
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
              The clock stops when the first reply is sent, not when somebody ticks a box —
              it measures what this customer experienced.
            </p>
          )}
        </Card>

        {/* Four enquiries from one buyer is one buyer. Ringing them four times
            is how you lose them. */}
        {lead.otherOpenLeads.length > 0 && (
          <Card title={`${lead.otherOpenLeads.length} other open enquir${lead.otherOpenLeads.length === 1 ? 'y' : 'ies'} from this person`}>
            <ul className="grid gap-1">
              {lead.otherOpenLeads.map((o) => (
                <li key={o.id}>
                  <Link href={`/leads/${o.id}`} className="text-brand-700 hover:underline">
                    {o.registration ?? 'General enquiry'} · {label(o.stage)} · {stamp(o.receivedAt)}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {lead.message && (
          <Card title="What they said">
            <p className="whitespace-pre-line text-ink-muted">{lead.message}</p>
          </Card>
        )}

        <Card title="History">
          {timeline.length === 0 ? (
            <Empty title="Nothing recorded yet">
              Every reply, stage change and note appears here in order, so “who touched this and
              when” has one answer rather than several.
            </Empty>
          ) : (
            <ol className="grid gap-3">
              {timeline.map((entry) => (
                <li
                  key={entry.event?.id ?? entry.message?.id}
                  className="grid gap-0.5 border-l-2 border-edge pl-3"
                >
                  <div className="text-[12px] leading-4 text-ink-subtle">
                    {stamp(entry.at)}
                    {entry.event?.actorName && ` · ${entry.event.actorName}`}
                  </div>

                  {entry.event && (
                    <div>
                      {entry.event.kind === 'stage_changed'
                        ? <span>
                            Moved from <strong>{label(entry.event.fromStage ?? '')}</strong>
                            {' to '}<strong>{label(entry.event.toStage ?? '')}</strong>
                            {entry.event.detail && ` — ${entry.event.detail}`}
                          </span>
                        : <span>
                            {label(entry.event.kind)}
                            {entry.event.detail && ` — ${entry.event.detail}`}
                          </span>}
                    </div>
                  )}

                  {entry.message && (
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge
                          tone={entry.message.direction === 'inbound' ? 'neutral' : 'info'}
                          icon={entry.message.direction === 'inbound' ? '←' : '→'}
                          label={`${entry.message.direction === 'inbound' ? 'Received' : 'Sent'} · ${CHANNEL_LABELS[entry.message.channel] ?? entry.message.channel}`}
                        />
                        {entry.message.isMarketing && (
                          <StatusBadge tone="warning" icon="◎" label="Marketing" />
                        )}
                        {entry.message.status === 'blocked' && (
                          <StatusBadge tone="critical" icon="✕" label="Not sent" />
                        )}
                      </div>
                      {entry.message.subject && (
                        <div className="mt-1 font-medium">{entry.message.subject}</div>
                      )}
                      <p className="whitespace-pre-line text-ink-muted">{entry.message.body}</p>
                      {/* A blocked message is KEPT: "we did not send this, and
                          here is why" is the record that shows the gate works. */}
                      {entry.message.blockedReason && (
                        <p className="mt-1 text-[13px] leading-[18px] text-critical">
                          Not sent — {entry.message.blockedReason}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {canUpdate && (
          <Card title="Notes">
            <NoteControl leadId={lead.id} />
          </Card>
        )}
      </div>

      <div className="grid content-start gap-4">
        <Card title="Contact">
          <dl>
            <Row label="Name">{lead.contactName}</Row>
            <Row label="Phone">
              {lead.contactPhone
                ? <a href={`tel:${lead.contactPhone}`} className="text-brand-700 hover:underline">
                    {lead.contactPhone}
                  </a>
                : <span className="text-ink-subtle">Not given</span>}
            </Row>
            <Row label="Email">
              {lead.contactEmail
                ? <a href={`mailto:${lead.contactEmail}`} className="text-brand-700 hover:underline">
                    {lead.contactEmail}
                  </a>
                : <span className="text-ink-subtle">Not given</span>}
            </Row>
            <Row label="Postcode">
              {lead.contactPostcode ?? <span className="text-ink-subtle">Not given</span>}
            </Row>
          </dl>
        </Card>

        <Card title="What we may send">
          <p className="mb-3 text-[13px] leading-[18px] text-ink-muted">
            Answering this enquiry is a <strong>service</strong> message and needs no marketing
            consent. Offering them a different car is marketing, and does.
          </p>
          <dl>
            {lead.consent.map((c) => (
              <Row key={c.channel} label={CHANNEL_LABELS[c.channel] ?? c.channel}>
                <span className="flex flex-wrap justify-end gap-1.5">
                  <StatusBadge
                    tone={c.service.permitted ? 'good' : 'critical'}
                    icon={c.service.permitted ? '✓' : '✕'}
                    label="Reply"
                  />
                  <StatusBadge
                    tone={c.marketing.permitted ? 'good' : 'neutral'}
                    icon={c.marketing.permitted ? '✓' : '✕'}
                    label="Marketing"
                  />
                </span>
              </Row>
            ))}
          </dl>
          {/* The reason, in the gate's own words, so a refusal is explainable
              to the customer and to a regulator without reading the code. */}
          <ul className="mt-3 grid gap-1 text-[12px] leading-4 text-ink-subtle">
            {lead.consent.filter((c) => !c.marketing.permitted).map((c) => (
              <li key={c.channel}>
                {CHANNEL_LABELS[c.channel] ?? c.channel} marketing: {c.marketing.reason}
              </li>
            ))}
          </ul>
        </Card>

        {lead.vehicleId && (
          <Card title="The car they asked about">
            {lead.vehicleRegistration && <Reg value={lead.vehicleRegistration} />}
            <p className="mt-2 font-medium">{lead.vehicleDescription ?? 'Not identified'}</p>
            <Link
              href={`/stock/${lead.vehicleId}`}
              className="mt-2 inline-block text-[13px] leading-[18px] text-brand-700 hover:underline"
            >
              Open in stock →
            </Link>
          </Card>
        )}

        {canUpdate && (
          <Card title={closed ? 'Closed' : 'Move this lead on'}>
            {closed
              ? <ReopenControl leadId={lead.id} />
              : <StageControl leadId={lead.id} stage={lead.stage} />}
          </Card>
        )}

        {canUpdate && (
          <Card title="Owner">
            <AssignControl leadId={lead.id} assignedTo={lead.assignedTo} people={people} />
          </Card>
        )}
      </div>
    </div>
  );
}
