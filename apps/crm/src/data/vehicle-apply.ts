/**
 * Booking a car in, editing it, repricing it and moving it through the
 * lifecycle.
 *
 * Out of the `'use server'` file for the reason recorded in `prep-move.ts`:
 * that module may export nothing but async functions, and a function that
 * needs a cookie cannot be tested against a real database. Everything here
 * takes a transaction, so `tests/integration/vehicle-book-in.test.ts` drives
 * the real code against real RLS.
 *
 * This is the first WRITE path for the vehicle table. Until now the only
 * thing that inserted a vehicle was `seed-demo.mjs`, which is why three of
 * these details had never had to be right:
 *
 *  1. **Stock numbers come from a locked counter row** (`vehicle_stock_
 *     sequences`, migration 0023), not from `max(stock_sequence) + 1`. Two
 *     people booking in at once on a Saturday morning read the same max and
 *     one of them violates the unique index. The counter also survives a
 *     rollback without burning a number, which a SEQUENCE does not — and the
 *     stock number is a mandatory VAT stock book field, so a gap in the
 *     series is an inspection question.
 *
 *  2. **A duplicate registration is a sentence, not a constraint name.** The
 *     unique index is scoped `(tenant_id, registration)` deliberately — a
 *     global one would let one dealer discover another's stock — and the
 *     violation it raises has to become "you already have this car" with a
 *     link to it.
 *
 *  3. **Every write is one transaction with its audit row.** An audit trail
 *     committed separately can describe a book-in that rolled back.
 */

import type { Tx } from './db';
import { toPence } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
import { matchCatalogue } from './catalogue';
import {
  assessBookIn,
  formatStockNumber,
  isPurchaseSource,
  parsePoundsToPence,
  validateReprice,
  validateTransition,
  VEHICLE_STATES,
  type BookInDraft,
  type BookInProblem,
  type PurchaseSource,
  type VehicleState,
} from '@forecourt/domain';

// ------------------------------------------------------------- vocabulary

/**
 * The states a book-in may start in.
 *
 * Not the whole enum. A car being recorded for the first time has been bought
 * — it is not `live`, and offering `sold` here would create a sale with no
 * deal behind it. `sourcing` is deliberately absent too: that is a car the
 * dealer is thinking about, and this form is reached from "Book a car in".
 */
export const BOOK_IN_STATES = ['purchased', 'in_transit', 'booked_in'] as const;
export type BookInState = (typeof BOOK_IN_STATES)[number];

const isVehicleState = (v: string): v is VehicleState =>
  (VEHICLE_STATES as readonly string[]).includes(v);

const VAT_SCHEMES = ['margin', 'qualifying', 'non_qualifying'] as const;
type VatSchemeValue = (typeof VAT_SCHEMES)[number];
const isVatScheme = (v: string): v is VatSchemeValue =>
  (VAT_SCHEMES as readonly string[]).includes(v);

// ---------------------------------------------------------------- input

/**
 * Raw form values.
 *
 * Everything is a string because everything came from a `FormData`, and
 * parsing at this boundary rather than in the action keeps the parse and its
 * error message in the same place as the field it belongs to.
 */
export interface VehicleFormInput {
  siteId: string;
  registration: string;
  vin: string;
  make: string;
  model: string;
  derivative: string;
  derivativeCandidateCount: string;
  colour: string;
  fuelType: string;
  bodyStyle: string;
  transmission: string;
  doors: string;
  engineCc: string;
  mileage: string;
  /** Highest MOT odometer reading, from the registration lookup. */
  highestMotMileage: string;
  firstRegisteredOn: string;
  motExpiresOn: string;
  formerKeepers: string;
  purchaseSource: string;
  purchaseDate: string;
  purchasePrice: string;
  retailPrice: string;
  vatScheme: string;
  state: string;
  advertHeadline: string;
  advertDescription: string;
  notes: string;
  acknowledgeMileage: string;
}

export type VehicleOutcome =
  | { ok: true; vehicleId: string; stockNumber: string; warnings: BookInProblem[] }
  | {
    ok: false;
    error: string;
    problems: BookInProblem[];
    /**
     * What the dealer typed, handed back so the form can put it on screen again.
     *
     * React resets an uncontrolled form once its action resolves, so without
     * this a rejected submission empties every field — and this form is long
     * enough that losing it once would be the last time anyone used it. The
     * form feeds these straight back in as `defaultValue`, which is what the
     * reset restores to.
     */
    submitted?: VehicleFormInput;
  };

const fail = (error: string, problems: BookInProblem[] = []): VehicleOutcome =>
  ({ ok: false, error, problems });

// --------------------------------------------------------------- parsing

const trimmed = (v: string): string => v.trim();
const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** A whole number from a form field. Returns `undefined` when unparseable. */
function parseCount(v: string): number | null | undefined {
  const t = v.trim().replace(/,/g, '');
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return undefined;
  return Number(t);
}

interface ParsedForm {
  draft: BookInDraft;
  siteId: string;
  vin: string | null;
  colour: string | null;
  fuelType: string | null;
  bodyStyle: string | null;
  transmission: string | null;
  doors: number | null;
  engineCc: number | null;
  formerKeepers: number | null;
  motExpiresOn: string | null;
  advertHeadline: string | null;
  advertDescription: string | null;
  notes: string | null;
  state: VehicleState;
}

/**
 * Form strings into a domain draft, collecting every parse failure rather
 * than throwing on the first.
 *
 * A form that reports one problem per submission makes a dealer submit six
 * times to find out about six problems.
 */
function parseForm(
  input: VehicleFormInput,
  highestMotMileage: number | null,
  allowedStates: readonly string[],
): { problems: BookInProblem[] } | { parsed: ParsedForm } {
  const problems: BookInProblem[] = [];
  const bad = (field: keyof BookInDraft, code: string, message: string): void => {
    problems.push({ field, code, severity: 'error', message });
  };

  const mileage = parseCount(input.mileage);
  if (mileage === undefined) {
    bad('mileage', 'mileage_unreadable', 'Mileage must be a whole number of miles, like 42000.');
  }

  const purchase = parsePoundsToPence(input.purchasePrice);
  if (!purchase.ok) bad('purchasePricePence', 'purchase_price_unreadable', purchase.message);

  const retail = parsePoundsToPence(input.retailPrice);
  if (!retail.ok) bad('retailPricePence', 'retail_price_unreadable', retail.message);

  const source = trimmed(input.purchaseSource);
  if (source !== '' && !isPurchaseSource(source)) {
    bad('purchaseSource', 'purchase_source_unknown', 'Choose where the car came from from the list.');
  }

  const scheme = trimmed(input.vatScheme);
  if (scheme !== '' && !isVatScheme(scheme)) {
    bad('vatScheme', 'vat_scheme_unknown', 'Choose margin, qualifying or non-qualifying.');
  }

  const state = trimmed(input.state);
  if (!isVehicleState(state) || !allowedStates.includes(state)) {
    bad('registration', 'state_unknown',
      `"${state}" is not a state this car can be in. Pick one from the list.`);
  }

  const doors = parseCount(input.doors);
  if (doors === undefined) bad('make', 'doors_unreadable', 'Doors must be a whole number.');
  const engineCc = parseCount(input.engineCc);
  if (engineCc === undefined) bad('make', 'engine_unreadable', 'Engine size must be a whole number of cc.');
  const formerKeepers = parseCount(input.formerKeepers);
  if (formerKeepers === undefined) {
    bad('make', 'keepers_unreadable', 'Former keepers must be a whole number.');
  }

  const siteId = trimmed(input.siteId);
  if (siteId === '') {
    bad('registration', 'no_site', 'Choose which site this car is at.');
  }

  if (problems.length > 0) return { problems };

  const candidateCount = parseCount(input.derivativeCandidateCount) ?? 1;

  return {
    parsed: {
      siteId,
      vin: orNull(input.vin),
      colour: orNull(input.colour),
      fuelType: orNull(input.fuelType),
      bodyStyle: orNull(input.bodyStyle),
      transmission: orNull(input.transmission),
      doors: doors ?? null,
      engineCc: engineCc ?? null,
      formerKeepers: formerKeepers ?? null,
      motExpiresOn: orNull(input.motExpiresOn),
      advertHeadline: orNull(input.advertHeadline),
      advertDescription: orNull(input.advertDescription),
      notes: orNull(input.notes),
      state: state as VehicleState,
      draft: {
        registration: trimmed(input.registration),
        vin: orNull(input.vin),
        make: orNull(input.make),
        model: orNull(input.model),
        derivative: orNull(input.derivative),
        derivativeCandidateCount: candidateCount,
        colour: orNull(input.colour),
        fuelType: orNull(input.fuelType),
        mileage: mileage ?? null,
        highestMotMileage,
        mileageAnomalyAcknowledged: input.acknowledgeMileage === 'on'
          || input.acknowledgeMileage === 'true',
        firstRegisteredOn: orNull(input.firstRegisteredOn),
        purchaseSource: source === '' ? null : (source as PurchaseSource),
        purchaseDate: orNull(input.purchaseDate),
        purchasePricePence: purchase.ok ? purchase.pence : null,
        vatScheme: scheme === '' ? null : (scheme as VatSchemeValue),
        retailPricePence: retail.ok ? retail.pence : null,
      },
    },
  };
}

// ------------------------------------------------------- stock numbering

/**
 * Take the next stock number for a site, holding the counter row.
 *
 * `FOR UPDATE` serialises allocation within the site; the increment is written
 * back in the SAME transaction as the vehicle, so an abandoned book-in does
 * not consume a number. That is the whole reason this is a row and not a
 * Postgres sequence — M11 reached the same conclusion for invoice numbers, and
 * the stock number is a VAT stock book field for the same audience.
 */
async function takeStockNumber(
  tx: Tx,
  session: Session,
  siteId: string,
): Promise<{ sequence: number; stockNumber: string }> {
  // The row may not exist yet: migration 0023 backfills a counter for every
  // site that already has cars, and a brand-new site has none.
  await tx`
    INSERT INTO vehicle_stock_sequences (tenant_id, site_id, prefix)
    SELECT ${session.tenantId}::uuid, ${siteId}::uuid, coalesce(s.stock_number_prefix, '')
      FROM sites s WHERE s.id = ${siteId}::uuid
    ON CONFLICT (tenant_id, site_id) DO NOTHING`;

  const [row] = await tx<{ prefix: string; last_number: string }[]>`
    SELECT prefix, last_number FROM vehicle_stock_sequences
    WHERE tenant_id = ${session.tenantId}::uuid AND site_id = ${siteId}::uuid
    FOR UPDATE`;

  if (!row) {
    // RLS returned nothing, which here means the site is not this tenant's or
    // not in the user's scope. Same answer either way, and it does not confirm
    // whether the site exists.
    throw new Error('SITE_NOT_AVAILABLE');
  }

  const sequence = Number(row.last_number) + 1;

  await tx`
    UPDATE vehicle_stock_sequences
       SET last_number = ${sequence}, updated_at = now()
     WHERE tenant_id = ${session.tenantId}::uuid AND site_id = ${siteId}::uuid`;

  return { sequence, stockNumber: formatStockNumber(row.prefix || null, sequence) };
}

// ------------------------------------------------------------- book-in

/**
 * A `date` column as the form spells it, for comparing the two sides of a diff.
 *
 * Postgres hands back a Date and the form submits "2024-03-01". Left alone the
 * two never match, so every edit would record a change to every date on the
 * car and the audit trail would stop being worth reading.
 */
const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** Postgres unique-violation. */
const isUniqueViolation = (e: unknown, index: string): boolean =>
  typeof e === 'object' && e !== null
  && (e as { code?: string }).code === '23505'
  && String((e as { constraint_name?: string }).constraint_name ?? '').includes(index);

/**
 * Record a car the dealer has bought.
 *
 * The MOT history is read BEFORE the draft is assessed, because the mileage
 * anomaly check needs it and reading it afterwards would let a clocked car
 * through on the first submission and only catch it on the second.
 */
export async function applyBookIn(
  tx: Tx,
  session: Session,
  input: VehicleFormInput,
  now: Date = new Date(),
): Promise<VehicleOutcome> {
  // `mot_records` is keyed on `vehicle_id`, and this vehicle does not exist
  // yet — so at book-in the highest MOT reading can only come from the
  // registration lookup the form ran, carried in a hidden field. Re-running
  // the lookup here is not an option: rule 8 says an external call is a job,
  // never a request handler.
  //
  // A client could therefore omit it and dodge the anomaly check on the FIRST
  // save. It cannot dodge it afterwards: the value is stored on the row, the
  // edit path takes the higher of stored and submitted, and `goLiveBlockers`
  // re-checks against the stored value before the car can be advertised.
  const highestMotMileage = parseCount(input.highestMotMileage) ?? null;

  const parseResult = parseForm(input, highestMotMileage, BOOK_IN_STATES);
  if ('problems' in parseResult) {
    return fail('Some of what you entered could not be read. Fix the fields below.', parseResult.problems);
  }
  const { parsed } = parseResult;

  const catalogue = await matchCatalogue(tx, {
    make: parsed.draft.make,
    model: parsed.draft.model,
    derivative: parsed.draft.derivative,
  });
  if (!catalogue.ok) {
    return fail(
      'Pick the make, model and derivative from the list. We do not invent a trim.',
      catalogue.problems.map((p) => ({
        field: p.field,
        code: 'catalogue_unknown',
        severity: 'error' as const,
        message: p.message,
      })),
    );
  }
  if (catalogue.match.make) parsed.draft.make = catalogue.match.make.name;
  if (catalogue.match.model) parsed.draft.model = catalogue.match.model.name;
  if (catalogue.match.variant) parsed.draft.derivative = catalogue.match.variant.label;

  const assessment = assessBookIn(parsed.draft, now);
  if (!assessment.ok) {
    return fail(
      `${assessment.errors.length} thing${assessment.errors.length === 1 ? '' : 's'} to fix before this car can be booked in.`,
      assessment.errors,
    );
  }

  const registrationValue = assessment.normalisedRegistration;
  if (!registrationValue) {
    return fail('Enter the registration.', assessment.errors);
  }

  // Layer 4 of the tenancy checklist — the repository guard. RLS would refuse
  // the insert anyway through the RESTRICTIVE site_scope policy, but a
  // Postgres error is not an answer a dealer can act on.
  if (session.scope !== 'all_sites' && !session.siteIds.includes(parsed.siteId)) {
    return fail('You are not attached to that site, so you cannot book a car in there.', []);
  }

  // Asked BEFORE the insert, not caught after it.
  //
  // Every statement here runs inside one `sql.begin`, and a constraint
  // violation aborts the whole transaction — Postgres refuses everything that
  // follows. Catching the 23505 in JavaScript is therefore too late to be
  // useful: the handler runs, but the transaction it wants to return a tidy
  // message from is already dead, and the original error surfaces as a 500.
  // Booking a car in twice is an ordinary Monday-morning mistake, so it gets
  // an ordinary answer.
  //
  // This is a check, not a guarantee — the unique index remains the thing that
  // actually enforces it, and the savepoint around the insert below handles
  // the case where two people book the same plate in the same second.
  const [clash] = await tx<{ id: string; stock_number: string }[]>`
    SELECT id, stock_number FROM vehicles
     WHERE registration = ${registrationValue} AND deleted_at IS NULL
     LIMIT 1`;
  if (clash) {
    return fail(
      `${registrationValue} is already in your stock as ${clash.stock_number}.`,
      [{
        field: 'registration',
        code: 'registration_duplicate',
        severity: 'error',
        message:
          `You already have this car — it is ${clash.stock_number}. Open that record rather `
          + 'than booking it in twice. If it genuinely came back, change its state instead.',
      }],
    );
  }

  let allocated: { sequence: number; stockNumber: string };
  try {
    allocated = await takeStockNumber(tx, session, parsed.siteId);
  } catch (e) {
    if (e instanceof Error && e.message === 'SITE_NOT_AVAILABLE') {
      return fail('That site is not one you can book a car in at. Choose another.', []);
    }
    throw e;
  }

  const d = parsed.draft;
  const bookedInAt = parsed.state === 'booked_in' ? now : null;

  let vehicleId: string;
  try {
    // Inside a savepoint, so that losing the race against another book-in of
    // the same plate rolls back to here rather than killing the transaction.
    // The pre-check above catches this almost every time; this is for the
    // Saturday morning when two people book the same car in at once.
    const created = await tx.savepoint(async (sp) => {
      const [row] = await sp<{ id: string }[]>`
      INSERT INTO vehicles (
        tenant_id, site_id, stock_number, stock_sequence, registration, vin,
        make, model, derivative, make_id, model_id, variant_id,
        body_style, doors, transmission, fuel_type, engine_cc,
        colour, mileage, first_registered_on, mot_expires_on, former_keepers,
        state, state_changed_at, booked_in_at,
        vat_scheme, purchase_source, purchase_date, purchase_price_pence,
        retail_price_pence, price_changed_at,
        advert_headline, advert_description, notes,
        highest_mot_mileage, mileage_anomaly_acknowledged_by,
        created_by, updated_by
      ) VALUES (
        ${session.tenantId}::uuid, ${parsed.siteId}::uuid,
        ${allocated.stockNumber}, ${allocated.sequence}, ${registrationValue}, ${parsed.vin},
        ${d.make}, ${d.model}, ${d.derivative},
        ${catalogue.match.make?.id ?? null}::uuid,
        ${catalogue.match.model?.id ?? null}::uuid,
        ${catalogue.match.variant?.id ?? null}::uuid,
        ${parsed.bodyStyle}, ${parsed.doors},
        ${parsed.transmission}, ${parsed.fuelType}, ${parsed.engineCc},
        ${parsed.colour}, ${d.mileage}, ${d.firstRegisteredOn}, ${parsed.motExpiresOn},
        ${parsed.formerKeepers},
        ${parsed.state}::vehicle_state, ${now}, ${bookedInAt},
        ${d.vatScheme}::vat_scheme, ${d.purchaseSource}::purchase_source,
        ${d.purchaseDate}, ${d.purchasePricePence?.toString() ?? null},
        ${d.retailPricePence?.toString() ?? null},
        ${d.retailPricePence === null ? null : now},
        ${parsed.advertHeadline}, ${parsed.advertDescription}, ${parsed.notes},
        ${highestMotMileage},
        ${d.mileageAnomalyAcknowledged ? session.userId : null}::uuid,
        ${session.userId}::uuid, ${session.userId}::uuid
      ) RETURNING id`;
      return row;
    });

    if (!created) return fail('The car was not saved. Try again.', []);
    vehicleId = created.id;
  } catch (e) {
    if (isUniqueViolation(e, 'registration')) {
      return fail(
        `${registrationValue} was booked in by someone else a moment ago.`,
        [{
          field: 'registration',
          code: 'registration_duplicate',
          severity: 'error',
          message:
            'Somebody booked this car in while you were filling the form. Open it from the '
            + 'stock list — what you typed here has not been saved.',
        }],
      );
    }
    throw e;
  }

  // The lifecycle history starts here. Every days metric in the product is
  // computed from the gaps between these rows, so the first one matters as
  // much as the rest.
  await tx`
    INSERT INTO vehicle_status_history (tenant_id, site_id, vehicle_id, from_state, to_state, reason, actor_id)
    VALUES (${session.tenantId}::uuid, ${parsed.siteId}::uuid, ${vehicleId}::uuid,
            NULL, ${parsed.state}::vehicle_state, 'Booked in', ${session.userId}::uuid)`;

  if (d.retailPricePence !== null) {
    await tx`
      INSERT INTO vehicle_prices (tenant_id, site_id, vehicle_id, price_pence, previous_price_pence, reason, source, actor_id)
      VALUES (${session.tenantId}::uuid, ${parsed.siteId}::uuid, ${vehicleId}::uuid,
              ${d.retailPricePence.toString()}, NULL, 'Price at book-in', 'manual', ${session.userId}::uuid)`;
  }

  await writeAudit({
    tx,
    session,
    siteId: parsed.siteId,
    resourceType: 'vehicle',
    resourceId: vehicleId,
    action: 'vehicle.book_in',
    before: null,
    after: {
      stockNumber: allocated.stockNumber,
      registration: registrationValue,
      make: d.make,
      model: d.model,
      derivative: d.derivative,
      mileage: d.mileage,
      state: parsed.state,
      vatScheme: d.vatScheme,
      purchaseSource: d.purchaseSource,
      purchasePricePence: d.purchasePricePence,
      retailPricePence: d.retailPricePence,
    },
  });

  return { ok: true, vehicleId, stockNumber: allocated.stockNumber, warnings: assessment.warnings };
}

// ---------------------------------------------------------------- edit

/**
 * Change a car's details.
 *
 * The price is deliberately NOT editable here — it goes through `applyReprice`
 * so that every change appends to `vehicle_prices`. Letting an edit form write
 * `retail_price_pence` directly would put price changes outside the history
 * the public site's price-drop badge and the aging ladder both read.
 *
 * The VAT scheme is refused once `vat_scheme_locked_at` is set, which happens
 * when a sale is invoiced. Changing it afterwards would re-date which scheme
 * applied at the point of sale, and the stock book has already reported it.
 */
export async function applyVehicleEdit(
  tx: Tx,
  session: Session,
  vehicleId: string,
  input: VehicleFormInput,
  now: Date = new Date(),
): Promise<VehicleOutcome> {
  const [existing] = await tx<Record<string, never>[]>`
    SELECT * FROM vehicles WHERE id = ${vehicleId}::uuid AND deleted_at IS NULL FOR UPDATE`;

  if (!existing) {
    return fail('That car is not in your stock. It may have been archived.', []);
  }
  const before = existing as unknown as Record<string, string | number | boolean | Date | null>;

  // The higher of what we hold and what the form carried, never the lower. The
  // stored value is authoritative — a submitted one can only ever raise the
  // bar, so re-running the lookup can add evidence but a crafted form cannot
  // remove it and slip a clocked car past the anomaly check.
  const storedMot = before['highest_mot_mileage'] === null
    ? null : Number(before['highest_mot_mileage']);
  const submittedMot = parseCount(input.highestMotMileage) ?? null;
  const highestMotMileage = storedMot === null
    ? submittedMot
    : Math.max(storedMot, submittedMot ?? storedMot);

  // An edit cannot change the state — that is `applyVehicleTransition`, which
  // enforces the state machine. Carry the current state through so the parse
  // accepts it.
  const currentState = String(before['state']);
  const parseResult = parseForm(
    { ...input, state: currentState },
    highestMotMileage,
    [currentState],
  );
  if ('problems' in parseResult) {
    return fail('Some of what you entered could not be read. Fix the fields below.', parseResult.problems);
  }
  const { parsed } = parseResult;

  const catalogue = await matchCatalogue(tx, {
    make: parsed.draft.make,
    model: parsed.draft.model,
    derivative: parsed.draft.derivative,
  });
  if (!catalogue.ok) {
    return fail(
      'Pick the make, model and derivative from the list. We do not invent a trim.',
      catalogue.problems.map((p) => ({
        field: p.field,
        code: 'catalogue_unknown',
        severity: 'error' as const,
        message: p.message,
      })),
    );
  }
  if (catalogue.match.make) parsed.draft.make = catalogue.match.make.name;
  if (catalogue.match.model) parsed.draft.model = catalogue.match.model.name;
  if (catalogue.match.variant) parsed.draft.derivative = catalogue.match.variant.label;

  // The price is owned by applyReprice. Assess against the stored price so a
  // stale hidden field cannot make the assessment disagree with the database.
  const storedRetail = before['retail_price_pence'] === null
    ? null : toPence(before['retail_price_pence'] as string);

  const assessment = assessBookIn({ ...parsed.draft, retailPricePence: storedRetail }, now);
  if (!assessment.ok) {
    return fail(
      `${assessment.errors.length} thing${assessment.errors.length === 1 ? '' : 's'} to fix.`,
      assessment.errors,
    );
  }

  const registrationValue = assessment.normalisedRegistration;
  if (!registrationValue) return fail('Enter the registration.', assessment.errors);

  const lockedAt = before['vat_scheme_locked_at'];
  const schemeBefore = before['vat_scheme'] as string | null;
  if (lockedAt !== null && parsed.draft.vatScheme !== schemeBefore) {
    return fail(
      'The VAT scheme was locked when this car was invoiced and cannot be changed. If it was '
      + 'recorded wrongly, the correction is an adjusting stock book entry, not an edit.',
      [{
        field: 'vatScheme',
        code: 'vat_scheme_locked',
        severity: 'error',
        message: `Locked as ${schemeBefore} at the point of sale.`,
      }],
    );
  }

  // Asked before the UPDATE, for the reason given in `applyBookIn`: a
  // constraint violation inside this transaction cannot be answered politely
  // after the fact, because by then Postgres has abandoned the transaction.
  if (registrationValue !== before['registration']) {
    const [clash] = await tx<{ stock_number: string }[]>`
      SELECT stock_number FROM vehicles
       WHERE registration = ${registrationValue} AND deleted_at IS NULL
         AND id <> ${vehicleId}::uuid
       LIMIT 1`;
    if (clash) {
      return fail(
        `${registrationValue} is already on ${clash.stock_number}.`,
        [{
          field: 'registration',
          code: 'registration_duplicate',
          severity: 'error',
          message:
            `Two cars cannot share a plate. ${clash.stock_number} already has this one — `
            + 'check which of the two is right before changing either.',
        }],
      );
    }
  }

  const d = parsed.draft;
  const ackBefore = before['mileage_anomaly_acknowledged_by'] as string | null;
  const ackAfter = d.mileageAnomalyAcknowledged ? (ackBefore ?? session.userId) : null;

  try {
    // Savepoint, for the same race the book-in guards against.
    await tx.savepoint(async (sp) => sp`
      UPDATE vehicles SET
        registration = ${registrationValue},
        vin = ${parsed.vin},
        make = ${d.make}, model = ${d.model}, derivative = ${d.derivative},
        make_id = ${catalogue.match.make?.id ?? null}::uuid,
        model_id = ${catalogue.match.model?.id ?? null}::uuid,
        variant_id = ${catalogue.match.variant?.id ?? null}::uuid,
        body_style = ${parsed.bodyStyle}, doors = ${parsed.doors},
        transmission = ${parsed.transmission}, fuel_type = ${parsed.fuelType},
        engine_cc = ${parsed.engineCc}, colour = ${parsed.colour},
        mileage = ${d.mileage},
        first_registered_on = ${d.firstRegisteredOn},
        mot_expires_on = ${parsed.motExpiresOn},
        former_keepers = ${parsed.formerKeepers},
        highest_mot_mileage = ${highestMotMileage},
        vat_scheme = ${d.vatScheme}::vat_scheme,
        purchase_source = ${d.purchaseSource}::purchase_source,
        purchase_date = ${d.purchaseDate},
        purchase_price_pence = ${d.purchasePricePence?.toString() ?? null},
        advert_headline = ${parsed.advertHeadline},
        advert_description = ${parsed.advertDescription},
        notes = ${parsed.notes},
        mileage_anomaly_acknowledged_by = ${ackAfter}::uuid,
        spec_edited = true,
        updated_at = ${now},
        updated_by = ${session.userId}::uuid
      WHERE id = ${vehicleId}::uuid`);
  } catch (e) {
    if (isUniqueViolation(e, 'registration')) {
      return fail(
        `${registrationValue} was put on another car a moment ago.`,
        [{
          field: 'registration',
          code: 'registration_duplicate',
          severity: 'error',
          message:
            'Somebody gave this plate to another car while you were editing. Nothing here '
            + 'has been saved — check which record is right.',
        }],
      );
    }
    throw e;
  }

  await writeAudit({
    tx,
    session,
    siteId: String(before['site_id']),
    resourceType: 'vehicle',
    resourceId: vehicleId,
    action: 'vehicle.update',
    // Every column this function writes, and nothing it does not.
    //
    // A subset is worse than it looks: `changedFields` records only what
    // differs, so an edit touching nothing on the list stores a NULL diff —
    // an audit row asserting that a change changed nothing. Colour, doors and
    // fuel did exactly that. The acknowledgement flag matters most of all,
    // being the override on a mileage reading below the MOT record.
    before: {
      registration: before['registration'],
      vin: before['vin'],
      make: before['make'], model: before['model'], derivative: before['derivative'],
      bodyStyle: before['body_style'], doors: before['doors'],
      transmission: before['transmission'], fuelType: before['fuel_type'],
      engineCc: before['engine_cc'], colour: before['colour'],
      mileage: before['mileage'],
      firstRegisteredOn: dateOnly(before['first_registered_on']),
      motExpiresOn: dateOnly(before['mot_expires_on']),
      formerKeepers: before['former_keepers'],
      highestMotMileage: before['highest_mot_mileage'],
      mileageAnomalyAcknowledgedBy: ackBefore,
      vatScheme: schemeBefore,
      purchaseSource: before['purchase_source'],
      purchaseDate: dateOnly(before['purchase_date']),
      purchasePricePence: before['purchase_price_pence'],
      advertHeadline: before['advert_headline'],
      advertDescription: before['advert_description'],
      notes: before['notes'],
    },
    after: {
      registration: registrationValue,
      vin: parsed.vin,
      make: d.make, model: d.model, derivative: d.derivative,
      bodyStyle: parsed.bodyStyle, doors: parsed.doors,
      transmission: parsed.transmission, fuelType: parsed.fuelType,
      engineCc: parsed.engineCc, colour: parsed.colour,
      mileage: d.mileage,
      firstRegisteredOn: dateOnly(d.firstRegisteredOn),
      motExpiresOn: dateOnly(parsed.motExpiresOn),
      formerKeepers: parsed.formerKeepers,
      highestMotMileage,
      mileageAnomalyAcknowledgedBy: ackAfter,
      vatScheme: d.vatScheme,
      purchaseSource: d.purchaseSource,
      purchaseDate: dateOnly(d.purchaseDate),
      purchasePricePence: d.purchasePricePence?.toString() ?? null,
      advertHeadline: parsed.advertHeadline,
      advertDescription: parsed.advertDescription,
      notes: parsed.notes,
    },
  });

  return {
    ok: true,
    vehicleId,
    stockNumber: String(before['stock_number']),
    warnings: assessment.warnings,
  };
}

// -------------------------------------------------------------- reprice

export type RepriceOutcome =
  | { ok: true; deltaPence: bigint }
  | { ok: false; error: string };

/**
 * Change the retail price, appending to the history.
 *
 * `vehicle_prices` is append-only (migration 0002 makes it so with a trigger),
 * and the row carries the PREVIOUS price as well as the new one. That is what
 * lets the public site say "was £12,995" without recomputing it from two rows
 * that a concurrent write could have reordered.
 */
export async function applyReprice(
  tx: Tx,
  session: Session,
  vehicleId: string,
  priceInput: string,
  reason: string,
  now: Date = new Date(),
): Promise<RepriceOutcome> {
  const parsed = parsePoundsToPence(priceInput);
  if (!parsed.ok) return { ok: false, error: parsed.message };
  if (parsed.pence === null) {
    return { ok: false, error: 'Enter the new price.' };
  }

  const [existing] = await tx<Record<string, never>[]>`
    SELECT id, site_id, retail_price_pence FROM vehicles
     WHERE id = ${vehicleId}::uuid AND deleted_at IS NULL FOR UPDATE`;

  if (!existing) return { ok: false, error: 'That car is not in your stock.' };
  const row = existing as unknown as Record<string, string | null>;
  // NOT NULL in the schema, so the index signature's `undefined` is noise here.
  const siteId = String(row['site_id']);

  const rawPrice = row['retail_price_pence'];
  const current = rawPrice === null || rawPrice === undefined ? null : toPence(rawPrice);

  const decision = validateReprice(current, parsed.pence);
  if (!decision.ok) return { ok: false, error: decision.message ?? 'That price cannot be used.' };

  await tx`
    UPDATE vehicles
       SET retail_price_pence = ${parsed.pence.toString()},
           price_changed_at = ${now},
           updated_at = ${now},
           updated_by = ${session.userId}::uuid
     WHERE id = ${vehicleId}::uuid`;

  await tx`
    INSERT INTO vehicle_prices (tenant_id, site_id, vehicle_id, price_pence,
                                previous_price_pence, reason, source, actor_id)
    VALUES (${session.tenantId}::uuid, ${siteId}::uuid, ${vehicleId}::uuid,
            ${parsed.pence.toString()}, ${current?.toString() ?? null},
            ${reason.trim() || null}, 'manual', ${session.userId}::uuid)`;

  await writeAudit({
    tx,
    session,
    siteId,
    resourceType: 'vehicle',
    resourceId: vehicleId,
    action: 'vehicle.reprice',
    before: { retailPricePence: current?.toString() ?? null },
    after: { retailPricePence: parsed.pence.toString(), reason: reason.trim() || null },
  });

  return { ok: true, deltaPence: decision.deltaPence ?? 0n };
}

// ------------------------------------------------------------ transition

export type TransitionOutcome =
  | { ok: true; state: VehicleState }
  | { ok: false; error: string; blockers?: readonly { code: string; message: string }[] };

/** Which lifecycle timestamp a state entry stamps, if any. */
const STATE_TIMESTAMP: Partial<Record<VehicleState, string>> = {
  booked_in: 'booked_in_at',
  ready: 'ready_at',
  live: 'live_at',
  reserved: 'reserved_at',
  sold: 'sold_at',
  delivered: 'delivered_at',
};

/**
 * Move a car through the lifecycle.
 *
 * The state machine and the go-live gate both live in the domain and are
 * enforced here rather than in the picker: a UI that offers a move the server
 * then refuses reads as a broken product, and a UI that hides one is a
 * convenience, never the control.
 */
export async function applyVehicleTransition(
  tx: Tx,
  session: Session,
  vehicleId: string,
  toState: string,
  overrideReason: string,
  now: Date = new Date(),
): Promise<TransitionOutcome> {
  if (!isVehicleState(toState)) {
    return { ok: false, error: `"${toState}" is not a state a car can be in.` };
  }

  const [existing] = await tx<Record<string, never>[]>`
    SELECT * FROM vehicles WHERE id = ${vehicleId}::uuid AND deleted_at IS NULL FOR UPDATE`;
  if (!existing) return { ok: false, error: 'That car is not in your stock.' };

  const v = existing as unknown as Record<string, string | number | boolean | Date | null>;

  // "Sold requires a linked deal" — a deal that is still alive. A cancelled or
  // unwound deal is precisely the case where the car should go back to Live,
  // so counting it would let a fallen-through sale mark the car sold again.
  const [deal] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM deals
     WHERE vehicle_id = ${vehicleId}::uuid
       AND state NOT IN ('cancelled', 'unwound')`;

  const override = overrideReason.trim();

  const result = validateTransition(
    {
      state: String(v['state']) as VehicleState,
      registration: v['registration'] as string | null,
      vatScheme: v['vat_scheme'] as 'margin' | 'qualifying' | 'non_qualifying' | null,
      retailPricePence: v['retail_price_pence'] === null
        ? null : toPence(v['retail_price_pence'] as string),
      publishedPhotoCount: Number(v['published_photo_count'] ?? 0),
      provenanceCheckedAt: v['provenance_checked_at'] as Date | null,
      provenanceAdverse: Boolean(v['provenance_adverse']),
      provenanceAcknowledgedBy: v['provenance_acknowledged_by'] as string | null,
      missingStockBookFields: [],
      hasDeposit: false,
      hasLinkedDeal: (deal?.n ?? 0) > 0,
      handoverChecklistComplete: false,
      dvlaNotified: false,
      mileage: v['mileage'] === null ? null : Number(v['mileage']),
      highestMotMileage: v['highest_mot_mileage'] === null ? null : Number(v['highest_mot_mileage']),
      mileageAnomalyAcknowledgedBy: v['mileage_anomaly_acknowledged_by'] as string | null,
    },
    toState,
    override === '' ? {} : { overrideReason: override, overriddenBy: session.userId },
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.message,
      ...(result.blockers ? { blockers: result.blockers } : {}),
    };
  }

  const stampColumn = STATE_TIMESTAMP[toState];
  const fromState = String(v['state']);

  await tx`
    UPDATE vehicles
       SET state = ${toState}::vehicle_state,
           state_changed_at = ${now},
           updated_at = ${now},
           updated_by = ${session.userId}::uuid
     WHERE id = ${vehicleId}::uuid`;

  // Stamped only on the FIRST entry into the state. A car that goes live,
  // comes back for prep and goes live again was first advertised on the first
  // date, and days-to-sell is measured from it.
  if (stampColumn) {
    await tx.unsafe(
      `UPDATE vehicles SET ${stampColumn} = $1 WHERE id = $2::uuid AND ${stampColumn} IS NULL`,
      [now as unknown as string, vehicleId],
    );
  }

  await tx`
    INSERT INTO vehicle_status_history (tenant_id, site_id, vehicle_id, from_state, to_state,
                                        override_reason, overridden_by, actor_id)
    VALUES (${session.tenantId}::uuid, ${v['site_id'] as string}::uuid, ${vehicleId}::uuid,
            ${fromState}::vehicle_state, ${toState}::vehicle_state,
            ${override || null}, ${override ? session.userId : null}::uuid,
            ${session.userId}::uuid)`;

  await writeAudit({
    tx,
    session,
    siteId: v['site_id'] as string,
    resourceType: 'vehicle',
    resourceId: vehicleId,
    action: 'vehicle.transition',
    before: { state: fromState },
    after: { state: toState, overrideReason: override || null },
  });

  return { ok: true, state: toState };
}
