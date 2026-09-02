'use server';

// NOTE: nothing but async functions may be exported from this file — it
// carries `'use server'`, and Next refuses a module that exports anything
// else. The types and the real work live in ./vehicle-apply.ts.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from './db';
import { requireSession } from '@/auth/session';
import {
  applyBookIn,
  applyReprice,
  applyVehicleEdit,
  applyVehicleTransition,
  type RepriceOutcome,
  type TransitionOutcome,
  type VehicleFormInput,
  type VehicleOutcome,
} from './vehicle-apply';
import { authorize } from '@forecourt/domain';

const text = (formData: FormData, key: string): string =>
  String(formData.get(key) ?? '');

/**
 * Every field the two vehicle forms submit, read in one place.
 *
 * Book-in and edit post the same shape deliberately: a dealer who books a car
 * in with three fields and fills the rest in on Tuesday should be looking at
 * the same form both times, and two form readers would drift.
 */
function readForm(formData: FormData): VehicleFormInput {
  return {
    siteId: text(formData, 'siteId'),
    registration: text(formData, 'registration'),
    vin: text(formData, 'vin'),
    make: text(formData, 'make'),
    model: text(formData, 'model'),
    derivative: text(formData, 'derivative'),
    derivativeCandidateCount: text(formData, 'derivativeCandidateCount'),
    colour: text(formData, 'colour'),
    fuelType: text(formData, 'fuelType'),
    bodyStyle: text(formData, 'bodyStyle'),
    transmission: text(formData, 'transmission'),
    doors: text(formData, 'doors'),
    engineCc: text(formData, 'engineCc'),
    mileage: text(formData, 'mileage'),
    highestMotMileage: text(formData, 'highestMotMileage'),
    firstRegisteredOn: text(formData, 'firstRegisteredOn'),
    motExpiresOn: text(formData, 'motExpiresOn'),
    formerKeepers: text(formData, 'formerKeepers'),
    purchaseSource: text(formData, 'purchaseSource'),
    purchaseDate: text(formData, 'purchaseDate'),
    purchasePrice: text(formData, 'purchasePrice'),
    retailPrice: text(formData, 'retailPrice'),
    vatScheme: text(formData, 'vatScheme'),
    state: text(formData, 'state'),
    advertHeadline: text(formData, 'advertHeadline'),
    advertDescription: text(formData, 'advertDescription'),
    notes: text(formData, 'notes'),
    acknowledgeMileage: text(formData, 'acknowledgeMileage'),
  };
}

/**
 * Resolve who is asking and whether they may.
 *
 * Server-side, on every action. The forms hide controls a role cannot use;
 * this is the control. `authorize` rather than `holds` because it also carries
 * the step-up and MFA state a sensitive permission may require.
 */
async function permitted(
  permission: string,
  activity: string,
): Promise<
  | { allowed: true; session: Awaited<ReturnType<typeof requireSession>> }
  | { allowed: false; reason: string }
> {
  const session = await requireSession();
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt,
    mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, permission);

  if (decision.allowed) return { allowed: true, session };

  // `decision.reason` is "Missing permission: vehicle.create", which is true
  // and is not something to show a dealer. Say what they cannot do and who can
  // change it — an error that names no next step is the one CLAUDE.md bans.
  return {
    allowed: false,
    reason: `Your role cannot ${activity}. Ask an owner or manager to do it, or to change your access.`,
  };
}

/**
 * Book a car in.
 *
 * On success this REDIRECTS to the new vehicle rather than returning it,
 * because the next thing a dealer does is photograph the car and the vehicle
 * page is where that starts. `redirect` throws, so it must be outside the
 * transaction — calling it inside `withSession` would abort the transaction
 * that just created the car.
 */
export async function bookInVehicle(
  _previous: VehicleOutcome | null,
  formData: FormData,
): Promise<VehicleOutcome> {
  const permission = await permitted('vehicle.create', 'book a car in');
  if (!permission.allowed) return { ok: false, error: permission.reason, problems: [] };
  const { session } = permission;

  const input = readForm(formData);
  const result = await withSession(session, (tx) => applyBookIn(tx, session, input));

  if (!result.ok) return { ...result, submitted: input };

  revalidatePath('/stock');
  revalidatePath('/');
  redirect(`/stock/${result.vehicleId}?booked=${encodeURIComponent(result.stockNumber)}`);
}

/** Change a car's details. Price and state are separate actions. */
export async function updateVehicle(
  _previous: VehicleOutcome | null,
  formData: FormData,
): Promise<VehicleOutcome> {
  const permission = await permitted('vehicle.update', "change a car's details");
  if (!permission.allowed) return { ok: false, error: permission.reason, problems: [] };
  const { session } = permission;

  const vehicleId = text(formData, 'vehicleId');
  if (vehicleId === '') return { ok: false, error: 'No car was named.', problems: [] };

  const input = readForm(formData);
  const result = await withSession(session, (tx) =>
    applyVehicleEdit(tx, session, vehicleId, input));

  if (!result.ok) return { ...result, submitted: input };

  revalidatePath('/stock');
  revalidatePath(`/stock/${vehicleId}`);
  redirect(`/stock/${vehicleId}?saved=1`);
}

/**
 * Change the retail price.
 *
 * A separate permission from `vehicle.update` because it is a separate
 * judgement: the prep coordinator who corrects a mileage should not be able to
 * discount a car by two thousand pounds.
 */
export async function repriceVehicle(
  _previous: RepriceOutcome | null,
  formData: FormData,
): Promise<RepriceOutcome> {
  const permission = await permitted('vehicle.price.update', 'change a price');
  if (!permission.allowed) return { ok: false, error: permission.reason };
  const { session } = permission;

  const vehicleId = text(formData, 'vehicleId');
  if (vehicleId === '') return { ok: false, error: 'No car was named.' };

  const result = await withSession(session, (tx) => applyReprice(
    tx, session, vehicleId, text(formData, 'retailPrice'), text(formData, 'reason'),
  ));

  if (result.ok) {
    revalidatePath('/stock');
    revalidatePath(`/stock/${vehicleId}`);
  }
  return result;
}

/**
 * Move a car through the lifecycle.
 *
 * Going LIVE is `vehicle.publish`, not `vehicle.update` — advertising a car is
 * the act with the regulatory exposure attached, and M3's go-live gate is the
 * thing standing behind it. Every other move is an operational one.
 */
export async function transitionVehicle(
  _previous: TransitionOutcome | null,
  formData: FormData,
): Promise<TransitionOutcome> {
  const toState = text(formData, 'toState');
  const permission = toState === 'live'
    ? await permitted('vehicle.publish', 'advertise a car')
    : await permitted('vehicle.update', 'move a car through the lifecycle');
  if (!permission.allowed) return { ok: false, error: permission.reason };
  const { session } = permission;

  const vehicleId = text(formData, 'vehicleId');
  if (vehicleId === '') return { ok: false, error: 'No car was named.' };

  const result = await withSession(session, (tx) => applyVehicleTransition(
    tx, session, vehicleId, toState, text(formData, 'overrideReason'),
  ));

  if (result.ok) {
    revalidatePath('/stock');
    revalidatePath(`/stock/${vehicleId}`);
    revalidatePath('/');
  }
  return result;
}
