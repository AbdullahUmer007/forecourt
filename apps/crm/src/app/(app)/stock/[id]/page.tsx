import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadVehicle } from '@/data/stock';
import { Card, StatusBadge, Figure, Amount, Reg, Row, Problem } from '@/components/ui';
import { holds, goLiveBlockers, OVERAGE_DAYS, format, subtract } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function VehiclePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const canSeeCost = holds(principal, 'vehicle.cost.read');

  const vehicle = await loadVehicle(session, id, canSeeCost);
  if (!vehicle) notFound();

  // M3's gate. Every blocker carries whether it can be overridden, because the
  // dealer needs to know what to fix rather than that something is wrong.
  const blockers = goLiveBlockers({
    state: vehicle.state,
    registration: vehicle.registration,
    vatScheme: vehicle.vatScheme as 'margin' | 'qualifying' | 'non_qualifying' | null,
    retailPricePence: vehicle.retailPrice?.amount ?? null,
    publishedPhotoCount: vehicle.publishedPhotoCount,
    provenanceCheckedAt: vehicle.provenanceCheckedAt,
    provenanceAdverse: vehicle.provenanceAdverse,
    provenanceAcknowledgedBy: null,
    // The stock book lives in M11 and is not loaded on this screen;
    // the list surfaces the gate, the stock-book report owns its own.
    missingStockBookFields: [],
    hasDeposit: false,
    hasLinkedDeal: false,
    handoverChecklistComplete: false,
    dvlaNotified: false,
    mileage: vehicle.mileage,
    highestMotMileage: vehicle.highestMotMileage,
    mileageAnomalyAcknowledgedBy: vehicle.mileageAnomalyAcknowledged ? 'ack' : null,
  });

  const description = [vehicle.make, vehicle.model, vehicle.derivative]
    .filter(Boolean).join(' ');
  const overage = vehicle.daysInStock !== null && vehicle.daysInStock >= OVERAGE_DAYS;
  // Same rule as the list: no recorded cost means no gross, not a gross
  // equal to the whole retail price.
  const costed = vehicle.totalCost !== null && vehicle.totalCost.amount > 0n;
  const margin = costed && vehicle.retailPrice
    ? subtract(vehicle.retailPrice, vehicle.totalCost!) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-4">
        <Card>
          <Link href="/stock" className="text-[13px] leading-[18px] text-brand-700 hover:underline">
            ← Stock
          </Link>

          <div className="mt-2 flex flex-wrap items-start gap-3">
            <Reg value={vehicle.registration} />
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] leading-7 font-semibold">
                {description || 'Not identified'}
              </h1>
              <p className="text-ink-subtle">
                <span className="mono">{vehicle.stockNumber}</span>
                {vehicle.siteName && ` · ${vehicle.siteName}`}
                {vehicle.daysInStock !== null && ` · ${vehicle.daysInStock} days in stock`}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge tone="info" icon="●" label={label(vehicle.state)} />
            {overage && (
              <StatusBadge tone="warning" icon="⏱" label={`Overage — ${vehicle.daysInStock} days`} />
            )}
            {vehicle.vatScheme && (
              <StatusBadge
                tone="neutral"
                icon="£"
                label={vehicle.vatScheme === 'margin' ? 'Margin scheme' : 'VAT qualifying'}
              />
            )}
            {vehicle.provenanceAdverse && (
              <StatusBadge tone="critical" icon="!" label="Adverse provenance" />
            )}
          </div>
        </Card>

        {/* The gate, in words. A car that cannot be advertised is the thing a
            dealer needs to see BEFORE they wonder why the phone is quiet. */}
        {blockers.length > 0 && vehicle.state !== 'live' && (
          <Problem title={`${blockers.length} thing${blockers.length === 1 ? '' : 's'} before this can go live`}>
            <ul className="grid gap-2">
              {blockers.map((b) => (
                <li key={b.code} className="grid gap-0.5">
                  <StatusBadge
                    tone={b.overridable ? 'warning' : 'critical'}
                    icon={b.overridable ? '!' : '✕'}
                    label={b.overridable ? 'Needs a reason' : 'Must fix'}
                  />
                  <span className="text-[13px] leading-[18px] text-ink-muted">{b.message}</span>
                </li>
              ))}
            </ul>
          </Problem>
        )}

        <Card title="Specification">
          <dl className="grid sm:grid-cols-2 sm:gap-x-6">
            <Row label="Registered">{date(vehicle.firstRegisteredOn)}</Row>
            <Row label="Mileage">
              {vehicle.mileage === null ? '—' : `${vehicle.mileage.toLocaleString('en-GB')} miles`}
            </Row>
            <Row label="Body">{vehicle.bodyStyle ?? '—'}</Row>
            <Row label="Doors">{vehicle.doors ?? '—'}</Row>
            <Row label="Gearbox">{vehicle.transmission ?? '—'}</Row>
            <Row label="Fuel">{vehicle.fuelType ?? '—'}</Row>
            <Row label="Engine">{vehicle.engineCc ? `${vehicle.engineCc}cc` : '—'}</Row>
            <Row label="Colour">{vehicle.colour ?? '—'}</Row>
            <Row label="MOT expires">{date(vehicle.motExpiresOn)}</Row>
            <Row label="Former keepers">{vehicle.formerKeepers ?? '—'}</Row>
            <Row label="Service history">
              {vehicle.serviceHistoryType ? label(vehicle.serviceHistoryType) : '—'}
            </Row>
            <Row label="Keys">{vehicle.keyCount ?? '—'}</Row>
            <Row label="V5C">{vehicle.v5cPresent ? 'Present' : 'Not present'}</Row>
            <Row label="VIN"><span className="mono text-[13px]">{vehicle.vin ?? '—'}</span></Row>
          </dl>
        </Card>

        {(vehicle.advertHeadline || vehicle.advertDescription) && (
          <Card title="Advert">
            {vehicle.advertHeadline && (
              <p className="mb-2 font-medium">{vehicle.advertHeadline}</p>
            )}
            {vehicle.advertDescription && (
              <p className="whitespace-pre-line text-ink-muted">{vehicle.advertDescription}</p>
            )}
          </Card>
        )}

        {vehicle.notes && (
          <Card title="Notes">
            <p className="whitespace-pre-line text-ink-muted">{vehicle.notes}</p>
          </Card>
        )}
      </div>

      <div className="grid content-start gap-4">
        <Card title="Price">
          <Figure
            label="Retail"
            value={vehicle.retailPrice ? format(vehicle.retailPrice) : 'Not set'}
            size="lg"
          />

          {/* Everything below is cost data. A sales executive without
              vehicle.cost.read never receives any of it — including the
              margin, which is DERIVED from cost and therefore withheld by the
              same rule. */}
          {canSeeCost ? (
            <dl className="mt-4 border-t border-edge pt-3">
              {vehicle.purchasePrice && vehicle.purchasePrice.amount > 0n && (
                <Row label="Purchase"><Amount value={vehicle.purchasePrice} /></Row>
              )}
              {costed ? (
                <Row label="Total cost"><Amount value={vehicle.totalCost!} /></Row>
              ) : (
                <Row label="Total cost">
                  <span className="text-ink-subtle">Not recorded</span>
                </Row>
              )}
              {margin && (
                <Row label="Gross">
                  <span className={margin.amount < 0n ? 'text-critical' : ''}>
                    <Amount value={margin} />
                  </span>
                </Row>
              )}
              {vehicle.minimumPrice && (
                <Row label="Floor"><Amount value={vehicle.minimumPrice} /></Row>
              )}
            </dl>
          ) : (
            <p className="mt-4 border-t border-edge pt-3 text-[13px] leading-[18px] text-ink-subtle">
              Purchase price, total cost and gross are not shown on your role.
            </p>
          )}
        </Card>

        <Card title="Dates">
          <dl>
            {canSeeCost && vehicle.purchaseDate && (
              <Row label="Purchased">{date(vehicle.purchaseDate)}</Row>
            )}
            {canSeeCost && vehicle.purchaseSource && (
              <Row label="Source">{label(vehicle.purchaseSource)}</Row>
            )}
            <Row label="Booked in">{date(vehicle.bookedInAt)}</Row>
            <Row label="Live">{date(vehicle.liveAt)}</Row>
          </dl>
        </Card>

        <Card title="Media">
          <Figure
            label="Published photographs"
            value={String(vehicle.publishedPhotoCount)}
            {...(vehicle.publishedPhotoCount === 0
              ? { hint: 'Every portal ranks a listing without pictures last.' }
              : {})}
          />
        </Card>

        <Card title="Provenance">
          {vehicle.provenanceCheckedAt === null ? (
            <>
              <StatusBadge tone="warning" icon="?" label="Not checked" />
              <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
                A car cannot go live without one. Advertising a car nobody has checked is the
                risk the gate exists to stop.
              </p>
            </>
          ) : vehicle.provenanceAdverse ? (
            <>
              <StatusBadge tone="critical" icon="!" label="Adverse result" />
              <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
                Checked {date(vehicle.provenanceCheckedAt)}. What was found is disclosed on the
                public page — a dealer who hides it is the dealer we sell against.
              </p>
            </>
          ) : (
            <>
              <StatusBadge tone="good" icon="✓" label="Checked" />
              <p className="mt-2 text-[13px] leading-[18px] text-ink-subtle">
                {date(vehicle.provenanceCheckedAt)}
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
