import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { loadSites } from '@/data/stock';
import { VehicleForm, type VehicleFormValues } from '@/components/vehicle-form';
import { holds } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Book a car in' };

export default async function BookInPage() {
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };

  // The server action checks this too. This check only decides whether to
  // render a form the dealer cannot submit — a permission wall they can read
  // beats a form that fails after they have typed for five minutes.
  if (!holds(principal, 'vehicle.create')) {
    redirect('/stock?denied=vehicle.create');
  }

  const sites = await loadSites(session);
  if (sites.length === 0) {
    return (
      <div className="mx-auto max-w-2xl rounded-md border border-edge bg-surface-1 p-6">
        <h1 className="text-[20px] leading-7 font-semibold">No site to book the car into</h1>
        <p className="mt-2 text-ink-muted">
          Every car belongs to a site, and this dealership has none set up yet. Add one
          in Settings and the book-in form will work.
        </p>
        <Link href="/settings" className="mt-4 inline-flex min-h-11 items-center text-link hover:underline">
          Go to Settings
        </Link>
      </div>
    );
  }

  const values: VehicleFormValues = {
    siteId: sites[0]!.id,
    registration: '', vin: '', make: '', model: '', derivative: '',
    derivativeCandidateCount: 0,
    colour: '', fuelType: '', bodyStyle: '', transmission: '', doors: '', engineCc: '',
    mileage: '', highestMotMileage: '',
    firstRegisteredOn: '', motExpiresOn: '', formerKeepers: '',
    purchaseSource: '', purchaseDate: '', purchasePrice: '',
    retailPrice: '', vatScheme: '',
    state: 'purchased',
    advertHeadline: '', advertDescription: '', notes: '',
    mileageAcknowledged: false,
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <Link href="/stock" className="text-[13px] leading-[18px] text-link hover:underline">
          ← Stock
        </Link>
        <h1 className="mt-1 text-[20px] leading-7 font-semibold">Book a car in</h1>
        <p className="mt-1 text-ink-muted">
          Record the registration and what you paid. The stock number is allocated
          when you save, and everything else can be filled in later.
        </p>
      </div>

      <VehicleForm
        mode="book-in"
        values={values}
        sites={sites}
        canSeeCost={holds(principal, 'vehicle.cost.read')}
        canSetPrice={holds(principal, 'vehicle.price.update')}
      />
    </div>
  );
}
