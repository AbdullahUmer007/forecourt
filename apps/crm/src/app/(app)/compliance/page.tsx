import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import {
  loadComplianceCentre, COMPLIANCE_DISCLAIMER, DISP_FINAL_RESPONSE_DAYS, ICO_NOTIFY_HOURS,
  type ComplaintRow, type BreachRow, type RegisterRow, type EvidenceGapRow,
} from '@/data/compliance';
import { Card, Figure, StatusBadge, Empty, Amount, Problem } from '@/components/ui';
import { holds, type ComplianceStatement } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Compliance' };

/**
 * The compliance centre.
 *
 * Two clocks that run whether or not anybody is looking at them — eight weeks
 * from a complaint being RECEIVED, seventy-two hours from becoming AWARE of a
 * breach — plus the permissions and policies that expire, and the deals that
 * cannot be evidenced.
 *
 * Every statement on this page carries its source. §27.4 requires a dealer's
 * own adviser to be able to check our interpretation, and a compliance claim
 * without a citation is an assertion we are not entitled to make about
 * somebody else's regulatory position. The disclaimer travels with the score
 * rather than sitting in a footer somebody can forget to render.
 *
 * The score never counts an unassessable area as a pass. That is the failure
 * mode of every compliance dashboard that flatters its customer: a denominator
 * that quietly excludes what could not be measured reads 100% for a dealer who
 * has recorded nothing at all.
 */

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const stamp = (d: Date): string =>
  d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * A statement, with its citation beside it.
 *
 * The citation is not decoration and it is not optional — it is the thing that
 * makes the sentence checkable by somebody who is not us.
 */
function Statement({ statement }: { statement: ComplianceStatement }) {
  return (
    <li className="grid gap-0.5 border-l-2 border-edge pl-3">
      <span className="text-ink-muted">{statement.message}</span>
      <span className="text-[12px] leading-4 text-ink-subtle">
        <a
          href={statement.citation.url}
          className="text-link hover:underline"
          rel="noreferrer noopener"
          target="_blank"
        >
          {statement.citation.reference}
        </a>
        {/* The one-line summary, for somebody who is not going to click. */}
        {statement.citation.summary && ` — ${statement.citation.summary}`}
      </span>
    </li>
  );
}

export default async function CompliancePage() {
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  if (!holds(principal, 'compliance.read')) notFound();

  const view = await loadComplianceCentre(session);

  // Ordered by how fast the clock is running. A 72-hour window beats an
  // eight-week one, and both beat a policy that expires next month.
  const breachesRunning = view.breaches.filter(
    (b) => !b.clock.reported && b.clock.statements.length > 0);
  const complaintsAtRisk = view.complaints.filter(
    (c) => c.clock.breached || c.clock.approaching);
  const registersExpiring = view.registers.filter(
    (r) => r.state === 'expired' || r.state === 'expiring');

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Compliance</h1>
        <p className="text-ink-muted">
          The clocks that run whether or not anybody is watching them
          {' · '}
          <span className={view.queryMs > 500 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {view.queryMs}ms
          </span>
        </p>
      </div>

      {/*
        The 72-hour clock first. It is the one measured in hours.

        A SUMMARY, not a second copy. This block used to render the full
        `BreachView` — every statement, every citation — and then the "Data
        breaches" card below rendered the identical thing again, word for word,
        a screen-height apart. Two copies of an urgent sentence do not make it
        twice as urgent; they make a reader wonder which one is the real one.
        The alert says what is running and how long is left; the record below
        says everything, once.
      */}
      {breachesRunning.length > 0 && (
        <Problem title={`${breachesRunning.length} data breach${breachesRunning.length === 1 ? '' : 'es'} with an open obligation`}>
          <ul className="grid gap-2">
            {breachesRunning.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 text-ink">{b.summary}</span>
                <StatusBadge
                  tone={b.clock.breached ? 'critical' : 'warning'}
                  icon={b.clock.breached ? '!' : '⏱'}
                  label={b.clock.breached
                    ? `${-b.clock.hoursRemaining}h past the deadline`
                    : `${b.clock.hoursRemaining}h left`}
                />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] leading-[18px]">
            <a href="#data-breaches" className="text-link hover:underline">
              What has to happen, and by when ↓
            </a>
          </p>
        </Problem>
      )}

      <div className="my-4 grid gap-2 sm:grid-cols-4">
        <Card>
          <Figure
            label="Compliance score"
            value={view.score.score === null ? 'Not yet' : `${view.score.score}%`}
            size="lg"
            hint={view.score.score === null
              ? 'Too little is measurable to state one'
              : `${view.score.areas.filter((a) => !a.unknown).length} areas assessed`}
          />
        </Card>
        <Card>
          <Figure
            label="Complaints open"
            value={String(view.complaints.filter((c) => !c.clock.answered).length)}
            hint={`${DISP_FINAL_RESPONSE_DAYS} days from receipt to a final response`}
          />
        </Card>
        <Card>
          <Figure
            label="Breaches"
            value={String(view.breaches.length)}
            hint={`${ICO_NOTIFY_HOURS} hours from becoming aware`}
          />
        </Card>
        <Card>
          <Figure
            label="Deals without evidence"
            value={String(view.gaps.length)}
            hint={view.gaps.length === 0
              ? 'Every financed deal can be evidenced'
              : 'Fill these in while memories are fresh'}
          />
        </Card>
      </div>

      {/* The score, with what it could NOT assess named beside it. */}
      <Card title="What the score means" className="mb-4">
        <p className="text-ink-muted">{view.score.summary}</p>

        {view.score.unassessed.length > 0 && (
          <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
            <strong>Not assessed at all:</strong> {view.score.unassessed.join(', ')}. These are
            left OUT of the fraction rather than counted as passing — a score that quietly
            excludes what it could not measure reads 100% for a dealership that has recorded
            nothing.
          </p>
        )}

        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {view.score.areas.map((area) => (
            <div key={area.key} className="flex items-baseline justify-between gap-3 border-b border-edge py-1">
              <dt className="text-ink-muted">{area.label}</dt>
              <dd>
                {area.unknown || area.checked === 0
                  ? <StatusBadge tone="neutral" icon="?" label="Nothing to check" />
                  : (
                    <span className="tnum">
                      {area.passing} of {area.checked}
                    </span>
                  )}
              </dd>
            </div>
          ))}
        </dl>

        {/* Travels with the score, not in a footer somebody forgets. */}
        <p className="mt-3 border-t border-edge pt-3 text-[12px] leading-4 text-ink-subtle">
          {COMPLIANCE_DISCLAIMER}
        </p>
      </Card>

      <Card title="Complaints" className="mb-4">
        {view.complaints.length === 0 ? (
          <Empty title="No complaints recorded">
            A complaint is anything a customer expresses dissatisfaction about, whether or not they
            call it a complaint. The eight-week clock runs from when it was RECEIVED — not from
            when somebody got round to logging it.
          </Empty>
        ) : (
          <ul className="grid gap-3">
            {[...complaintsAtRisk, ...view.complaints.filter((c) => !complaintsAtRisk.includes(c))]
              .map((c) => <ComplaintView key={c.id} complaint={c} />)}
          </ul>
        )}
      </Card>

      {view.breaches.length > 0 && (
        <div id="data-breaches" className="scroll-mt-32">
          <Card title="Data breaches" className="mb-4">
            <ul className="grid gap-3">
              {view.breaches.map((b) => <BreachView key={b.id} breach={b} />)}
            </ul>
          </Card>
        </div>
      )}

      <Card
        title="Permissions, insurance and policies"
        className="mb-4"
        {...(registersExpiring.length > 0
          ? {
            action: (
              <StatusBadge
                tone="warning" icon="!"
                label={`${registersExpiring.length} need attention`}
              />
            ),
          }
          : {})}
      >
        {view.registers.length === 0 ? (
          <Empty title="Nothing recorded">
            Trade plates, motor trade insurance, FCA permission, the AML policy and risk
            assessment, staff competence records. A lapsed trade plate is not a task — it is a
            business that cannot lawfully do what it is doing today.
          </Empty>
        ) : (
          <ul className="grid gap-2">
            {view.registers.map((r) => <RegisterView key={r.entry.id} register={r} />)}
          </ul>
        )}
      </Card>

      <Card title="Deals that cannot be evidenced" className="mb-4">
        {view.gaps.length === 0 ? (
          <Empty title="Every financed deal has its records">
            A cash sale has no finance evidence to be missing, so it is not counted here — flagging
            one would train you to ignore the list.
          </Empty>
        ) : (
          <>
            <ul className="grid gap-3">
              {view.gaps.map((g) => <GapView key={g.dealId} gap={g} />)}
            </ul>
            {/* Stated once for the section it governs, rather than repeated
                under every row it governs. */}
            {view.gaps.find((g) => g.statement)?.statement && (
              <ul className="mt-3 border-t border-edge pt-3">
                <Statement statement={view.gaps.find((g) => g.statement)!.statement!} />
              </ul>
            )}
          </>
        )}
      </Card>

      {view.tasks.length > 0 && (
        <Card title="Open tasks">
          <ul className="grid gap-2">
            {view.tasks.map((t) => (
              <li key={t.id} className="border-b border-edge pb-2 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{t.title}</span>
                  {t.dueOn && (
                    <StatusBadge
                      tone={t.dueOn < new Date() ? 'critical' : 'neutral'}
                      icon={t.dueOn < new Date() ? '!' : '⌚'}
                      label={`Due ${date(t.dueOn)}`}
                    />
                  )}
                </div>
                {t.detail && (
                  <p className="text-[13px] leading-[18px] text-ink-muted">{t.detail}</p>
                )}
                {t.citationUrl && t.citationRef && (
                  <a
                    href={t.citationUrl}
                    className="text-[12px] leading-4 text-link hover:underline"
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {t.citationRef}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ComplaintView({ complaint }: { complaint: ComplaintRow }) {
  const c = complaint.clock;
  return (
    <li className="border-b border-edge pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {complaint.reference && <span className="mono mr-2">{complaint.reference}</span>}
          {complaint.contactName ?? 'No contact linked'}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge tone="neutral" icon="·" label={label(complaint.status)} />
          {c.answered
            ? (
              <StatusBadge
                tone={c.breached ? 'warning' : 'good'}
                icon={c.breached ? '!' : '✓'}
                label={c.breached ? 'Answered late' : 'Answered in time'}
              />
            )
            : (
              <StatusBadge
                tone={c.breached ? 'critical' : c.approaching ? 'warning' : 'info'}
                icon={c.breached ? '!' : '⌚'}
                label={c.breached
                  ? `${-c.daysRemaining} days past the deadline`
                  : `${c.daysRemaining} days left · due ${date(c.finalResponseDueAt)}`}
              />
            )}
        </span>
      </div>

      <p className="mt-1 text-ink-muted">{complaint.summary}</p>

      {complaint.redress && (
        <p className="mt-1 text-[13px] leading-[18px] text-ink-subtle">
          Redress <Amount value={complaint.redress} />
          {complaint.rootCause && ` · ${complaint.rootCause}`}
        </p>
      )}

      {c.statements.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {c.statements.map((s) => <Statement key={s.code} statement={s} />)}
        </ul>
      )}
    </li>
  );
}

function BreachView({ breach }: { breach: BreachRow }) {
  const c = breach.clock;
  return (
    <li className="border-b border-edge pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{breach.summary}</span>
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge tone="neutral" icon="·" label={label(breach.status)} />
          {c.reported
            ? <StatusBadge tone="good" icon="✓" label={`Reported${breach.icoReference ? ` · ${breach.icoReference}` : ''}`} />
            : (
              <StatusBadge
                tone={c.breached ? 'critical' : 'warning'}
                icon={c.breached ? '!' : '⏱'}
                label={c.breached
                  ? `${-c.hoursRemaining}h past the deadline`
                  : `${c.hoursRemaining}h left · by ${stamp(c.icoDeadlineAt)}`}
              />
            )}
          {/* Three states. "Not assessed" is a finding, not a low-risk answer. */}
          {breach.highRisk === null
            ? <StatusBadge tone="warning" icon="?" label="Risk not assessed" />
            : breach.highRisk
              ? <StatusBadge tone="critical" icon="!" label="High risk to those affected" />
              : <StatusBadge tone="neutral" icon="✓" label="Assessed — not high risk" />}
        </span>
      </div>

      <p className="mt-1 text-[13px] leading-[18px] text-ink-subtle">
        Became aware {stamp(c.becameAwareAt)}
        {breach.subjectsAffected !== null && ` · ${breach.subjectsAffected} people affected`}
      </p>

      {breach.highRiskReason && (
        <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">
          {breach.highRiskReason}
        </p>
      )}

      {c.statements.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {c.statements.map((s) => <Statement key={s.code} statement={s} />)}
        </ul>
      )}
    </li>
  );
}

function RegisterView({ register }: { register: RegisterRow }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2 last:border-0 last:pb-0">
      <span>
        <span className="font-medium">{register.entry.description}</span>
        <span className="ml-2 text-[13px] leading-[18px] text-ink-subtle">
          {label(register.entry.kind)}
          {register.subjectName && ` · ${register.subjectName}`}
          {register.issuer && ` · ${register.issuer}`}
        </span>
        {register.statement && (
          <ul className="mt-1">
            <Statement statement={register.statement} />
          </ul>
        )}
      </span>
      <span>
        {register.state === 'expired' && (
          <StatusBadge tone="critical" icon="✕" label={`Expired ${date(register.entry.expiresOn)}`} />
        )}
        {register.state === 'expiring' && (
          <StatusBadge tone="warning" icon="!" label={`Expires ${date(register.entry.expiresOn)}`} />
        )}
        {register.state === 'valid' && (
          <StatusBadge tone="good" icon="✓" label={`Valid to ${date(register.entry.expiresOn)}`} />
        )}
        {register.state === 'no_expiry' && (
          <StatusBadge tone="neutral" icon="∞" label="No expiry recorded" />
        )}
      </span>
    </li>
  );
}

function GapView({ gap }: { gap: EvidenceGapRow }) {
  return (
    <li className="border-b border-edge pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/deals/${gap.dealId}`} className="font-medium text-link hover:underline">
          {gap.reference ?? 'Deal'}
          {gap.contactName && ` · ${gap.contactName}`}
        </Link>
        <StatusBadge
          tone="critical" icon="!"
          label={`${gap.missing.length} missing`}
        />
      </div>
      {gap.deliveredAt && (
        <p className="text-[13px] leading-[18px] text-ink-subtle">
          Delivered {date(gap.deliveredAt)}
        </p>
      )}
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {gap.missing.map((m) => (
          <li key={m}>
            <StatusBadge tone="critical" icon="✕" label={label(m)} />
          </li>
        ))}
      </ul>
      {/*
        The statement is NOT rendered per row.

        Every gap carries the same one — the same sentence, the same CONC 3.7 /
        SYSC 9.1 citation — so four deals printed it four times, and the
        repetition buried the only thing that differs between the rows, which
        is which records are missing from which deal. It is rendered once
        beneath the list instead. The citation requirement is satisfied by
        being present and checkable, not by being present four times.
      */}
    </li>
  );
}
