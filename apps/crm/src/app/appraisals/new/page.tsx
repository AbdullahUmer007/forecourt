import Link from 'next/link';
import { Card, Empty } from '../../../components/ui';

/**
 * Not built yet, and says so plainly.
 *
 * Capturing a new appraisal needs the DVLA/DVSA lookup (M4's free half, which
 * exists), a derivative picker (which does not — and M13 refuses to guess one),
 * photo upload through M5's pipeline, and an audit event per mutation. That is
 * a slice of its own rather than a form to knock out at the end of a session.
 *
 * A page that says what is missing beats a form that half-works and silently
 * writes an appraisal nobody can convert.
 */
export default function NewAppraisal() {
  return (
    <Card title="Appraise a car">
      <Empty
        title="Not built yet"
        action={
          <Link
            href="/appraisals"
            className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
          >
            Back to part-exchange
          </Link>
        }
      >
        Capturing an appraisal needs the registration lookup, a derivative picker and photo
        upload wired together. The read side is built — open a seeded appraisal from the list to
        see the damage map, the recon estimate and the offer working against real data.
      </Empty>
    </Card>
  );
}
