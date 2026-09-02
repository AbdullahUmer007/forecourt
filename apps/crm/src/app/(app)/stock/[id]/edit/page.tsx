import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { loadSites, loadVehicle } from '@/data/stock';
import { VehicleForm, type VehicleFormValues } from '@/components/vehicle-form';
import { holds, type Money } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit vehicle' };

/** An `<input type="date">` will only accept `yyyy-mm-dd`. */
const dateValue = (d: Date | null): string =>
  d === null ? '' : d.toISOString().slice(0, 10);

/**
 * Pence back to a plain pounds string for the input. No symbol, no grouping —
 * a thousands separator here would be re-parsed on submit, and `parsePoundsToPence`
 * rejects what it cannot read exactly rather than guessing.
 */
const poundsValue = (m: Money | null): string =>
  m === null ? '' : (Number(m.amount) / 100).toFixed(2);

const numberValue = (n: number | null): string => (n === null ? '' : String(n));

export default async function EditVehiclePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };

  if (!holds(principal, 'vehicle.update')) {
    redirect(`/stock/${id}?denied=vehicle.update`);
  }

  const canSeeCost = holds(principal, 'vehicle.cost.read');
  const [vehicle, sites] = await Promise.all([
    loadVehicle(session, id, canSeeCost),
    loadSites(session),
  ]);
  if (!vehicle) notFound();

  const values: VehicleFormValues = {
    vehicleId: vehicle.id,
    siteId: vehicle.siteId,
    registration: vehicle.registration,
    vin: vehicle.vin ?? '',
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    derivative: vehicle.derivative ?? '',
    // Only a fresh lookup produces candidates. An edit is never blocked on a
    // choice the dealer already made at book-in.
    derivativeCandidateCount: 0,
    colour: vehicle.colour ?? '',
    fuelType: vehicle.fuelType ?? '',
    bodyStyle: vehicle.bodyStyle ?? '',
    transmission: vehicle.transmission ?? '',
    doors: numberValue(vehicle.doors),
    engineCc: numberValue(vehicle.engineCc),
    mileage: numberValue(vehicle.mileage),
    highestMotMileage: numberValue(vehicle.highestMotMileage),
    firstRegisteredOn: dateValue(vehicle.firstRegisteredOn),
    motExpiresOn: dateValue(vehicle.motExpiresOn),
    formerKeepers: numberValue(vehicle.formerKeepers),
    purchaseSource: vehicle.purchaseSource ?? '',
    purchaseDate: dateValue(vehicle.purchaseDate),
    purchasePrice: poundsValue(vehicle.purchasePrice),
    retailPrice: poundsValue(vehicle.retailPrice),
    vatScheme: vehicle.vatScheme ?? '',
    state: vehicle.state,
    advertHeadline: vehicle.advertHeadline ?? '',
    advertDescription: vehicle.advertDescription ?? '',
    notes: vehicle.notes ?? '',
    mileageAcknowledged: vehicle.mileageAnomalyAcknowledged,
  };

  const description = [vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <Link href={`/stock/${vehicle.id}`} className="text-[13px] leading-[18px] text-link hover:underline">
          ← {vehicle.stockNumber} {description}
        </Link>
        <h1 className="mt-1 text-[20px] leading-7 font-semibold">
          Edit {description || 'vehicle'}
        </h1>
        <p className="mt-1 text-ink-muted">
          The stock number and the registration history stay as they are. Every change
          here is recorded against your name.
        </p>
      </div>

      <VehicleForm
        mode="edit"
        values={values}
        sites={sites}
        canSeeCost={canSeeCost}
        // Repricing is its own action with its own reason, on the vehicle page.
        canSetPrice={false}
      />
    </div>
  );
}
