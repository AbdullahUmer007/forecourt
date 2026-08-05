import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { listAppraisals, type AppraisalSummary } from '@/data/appraisals';
import { StatusBadge, Empty, Amount, Reg, type Tone } from '@/components/ui';
import type { AppraisalState } from '@forecourt/domain';
/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Part-exchange' };

/**
 * Every state gets an icon and a label — rule 2. The tone is chosen by what
 * the state means to the dealer, not by where it sits in the sequence:
 * `declined` is not a failure state, it is a normal outcome that can be
 * re-offered, so it is neutral rather than critical.
 */
const STATE_PRESENTATION: Record<AppraisalState, { tone: Tone; icon: string; label: string }> = {
  draft: { tone: 'neutral', icon: '✎', label: 'Draft' },
  appraised: { tone: 'info', icon: '◐', label: 'Appraised' },
  offered: { tone: 'info', icon: '→', label: 'Offered' },
  accepted: { tone: 'good', icon: '✓', label: 'Accepted' },
  declined: { tone: 'neutral', icon: '–', label: 'Declined' },
  expired: { tone: 'warning', icon: '⏱', label: 'Expired' },
  converted: { tone: 'good', icon: '⇥', label: 'In stock' },
  abandoned: { tone: 'neutral', icon: '×', label: 'Abandoned' },
};

export default async function AppraisalsPage() {
  const session = await requireSession();
  const appraisals = await listAppraisals(session);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-[34px] font-semibold">Part-exchange</h1>
          <p className="text-ink-muted">
            Appraise a customer&rsquo;s car, agree a figure, and take it into stock.
          </p>
        </div>
        {/* One primary action per view — rule 4. */}
        <Link
          href="/appraisals/new"
          className="inline-flex min-h-11 items-center rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
        >
          Appraise a car
        </Link>
      </div>

      {appraisals.length === 0 ? (
        <Empty title="No appraisals yet">
          When a customer brings a car in, appraise it here — mark the damage, price the recon
          against your standard costs, and give them a figure you can stand behind. The record
          stays, so you can tell them next week exactly what you offered and why.
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {appraisals.map((a) => (
            <AppraisalRow key={a.id} appraisal={a} />
          ))}
        </ul>
      )}
    </>
  );
}

function AppraisalRow({ appraisal: a }: { appraisal: AppraisalSummary }) {
  const state = STATE_PRESENTATION[a.state];
  const description = [a.make, a.model, a.derivative].filter(Boolean).join(' ');

  return (
    <li>
      {/* The whole row is the target, and it clears 44px comfortably. */}
      <Link
        href={`/appraisals/${a.id}`}
        className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-edge bg-surface-1 p-3 hover:border-edge-strong hover:bg-surface-3"
      >
        <Reg value={a.registration} />

        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{description || 'Vehicle not identified'}</div>
          <div className="truncate text-[13px] leading-[18px] text-ink-subtle">
            {a.contactName ?? 'No contact linked'}
            {a.mileage !== null && ` · ${a.mileage.toLocaleString('en-GB')} miles`}
          </div>
        </div>

        <StatusBadge tone={state.tone} icon={state.icon} label={state.label} />

        <div className="w-24 text-right">
          {a.allowance ? (
            <>
              <div className="font-semibold">
                <Amount value={a.allowance} />
              </div>
              {a.offerRevision !== null && a.offerRevision > 1 && (
                <div className="text-[12px] leading-4 text-ink-subtle">
                  revision {a.offerRevision}
                </div>
              )}
            </>
          ) : (
            <span className="text-ink-subtle">No offer</span>
          )}
        </div>
      </Link>
    </li>
  );
}
