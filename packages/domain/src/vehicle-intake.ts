/**
 * M3 — booking a car in.
 *
 * The vehicle lifecycle in `vehicle-lifecycle.ts` starts at `sourcing` and
 * says what must be true before a car may be advertised. It never says how a
 * car gets into the database in the first place, because until now nothing
 * put one there: every vehicle in the system arrived from a seed script.
 *
 * This is the missing front of that pipeline. It is deliberately SEPARATE from
 * the go-live gate: book-in and go-live ask different questions, and conflating
 * them is how a product ends up refusing to record a car that is sitting on the
 * forecourt because nobody has photographed it yet. A dealer books a car in the
 * moment they buy it, standing in an auction hall, knowing the registration and
 * the hammer price and very little else. Everything after that is progressive.
 *
 * So the split is:
 *
 *   book-in   — can we identify this car and account for it lawfully?
 *   go-live   — can we lawfully advertise it?  (`goLiveBlockers`)
 *
 * Two rules here carry real money and are worth reading before changing
 * anything:
 *
 *  1. **The VAT scheme is suggested, never chosen.** The purchase source is
 *     strong evidence and it is not proof. Only a purchase from a private
 *     individual is unambiguous; every other source depends on what the seller
 *     actually put on the invoice, which is a fact about a piece of paper and
 *     not something this code can infer. M13 reached the same conclusion from
 *     the other direction and refuses to convert a part-exchange until a human
 *     states whether a VAT invoice was issued. Getting this wrong makes a whole
 *     sale standard-rated, which on a £12,000 car is roughly £2,000 of VAT the
 *     dealer did not collect and now owes.
 *
 *  2. **Mileage below the highest MOT reading blocks the book-in** until
 *     somebody acknowledges it by name. It is simultaneously a fraud signal, a
 *     Consumer Rights Act exposure and, most often, a typo. All three want the
 *     same treatment: stop, show the number we already hold, make a person say
 *     they meant it.
 */

import type { VatScheme } from './vat.js';

// ---------------------------------------------------------------- sources

export const PURCHASE_SOURCES = [
  'auction', 'part_exchange', 'trade', 'private', 'consignment', 'fleet', 'lease_return',
] as const;

export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];

export const isPurchaseSource = (v: string): v is PurchaseSource =>
  (PURCHASE_SOURCES as readonly string[]).includes(v);

/** Dealer-facing labels. The enum value is an identifier, not copy. */
export const PURCHASE_SOURCE_LABELS: Record<PurchaseSource, string> = {
  auction: 'Auction',
  part_exchange: 'Part-exchange',
  trade: 'Trade',
  private: 'Private seller',
  consignment: 'Consignment',
  fleet: 'Ex-fleet',
  lease_return: 'Lease return',
};

// -------------------------------------------------------- registrations

/**
 * Stored form: uppercase, no separators.
 *
 * `packages/adapters` has an identical pair, because the adapter layer needs
 * them to key a DVLA lookup and cannot import the domain without creating a
 * cycle. They are four lines each and tested on both sides; sharing them would
 * cost more than it saves.
 */
export const normaliseRegistration = (input: string): string =>
  input.toUpperCase().replace(/[\s\-_.]/g, '');

/**
 * Cheap plausibility, not validation.
 *
 * Deliberately permissive: UK plates include dateless, Northern Ireland and
 * personalised formats, and a dealer buying a 1972 car at auction must be able
 * to book it in. A strict pattern here would reject real cars, and rejecting a
 * real car is worse than accepting a typo the dealer can see on the screen.
 */
export const isPlausibleRegistration = (input: string): boolean => {
  const r = normaliseRegistration(input);
  return r.length >= 2 && r.length <= 8 && /^[A-Z0-9]+$/.test(r);
};

// ------------------------------------------------------------ VAT scheme

export interface VatSchemeSuggestion {
  suggested: VatScheme | null;
  /**
   * Whether the source alone settles it. When false the UI must present the
   * suggestion as a question, not a pre-filled answer — a pre-selected radio
   * is a guess wearing a human's signature.
   */
  confident: boolean;
  reason: string;
}

/**
 * What the purchase source implies about the VAT scheme.
 *
 * Exactly one source is conclusive. That is not pessimism, it is the actual
 * position: the margin scheme applies where no VAT was recoverable on
 * purchase, and for every source except a private individual that depends on
 * what the seller invoiced.
 */
export function suggestVatScheme(source: PurchaseSource | null): VatSchemeSuggestion {
  switch (source) {
    case 'private':
      return {
        suggested: 'margin',
        confident: true,
        reason:
          'Bought from a private individual, so no VAT was recoverable on purchase. '
          + 'The margin scheme applies and the sales invoice must not show VAT separately.',
      };
    case 'part_exchange':
      return {
        suggested: 'margin',
        confident: false,
        reason:
          'A part-exchange from a private customer is margin scheme. If the customer was '
          + 'VAT-registered and issued a VAT invoice, it is qualifying instead — check the paperwork.',
      };
    case 'fleet':
    case 'lease_return':
      return {
        suggested: 'qualifying',
        confident: false,
        reason:
          'Ex-fleet and lease-return cars are usually sold on a standard VAT invoice, which makes '
          + 'them VAT qualifying. Confirm against the purchase invoice before you commit to it.',
      };
    case 'trade':
      return {
        suggested: null,
        confident: false,
        reason:
          'A trade purchase can be either. If the selling dealer invoiced under the margin scheme '
          + 'it is margin; if they charged VAT on the full price it is qualifying.',
      };
    case 'auction':
      return {
        suggested: null,
        confident: false,
        reason:
          'Auctions sell both. The invoice will say — margin cars carry no separate VAT line, '
          + 'qualifying cars charge VAT on the hammer price.',
      };
    case 'consignment':
      return {
        suggested: null,
        confident: false,
        reason:
          'A consignment car depends on who owns it at the point of sale and what they can invoice. '
          + 'Check before setting a scheme.',
      };
    case null:
      return {
        suggested: null,
        confident: false,
        reason: 'Record where the car came from and we can suggest the scheme.',
      };
  }
}

// ------------------------------------------------------------- the draft

/**
 * A book-in as the dealer has filled it in.
 *
 * Flat and primitive on purpose so this stays pure and testable without a
 * database, in the same shape as `VehicleSnapshot`. Dates are ISO `yyyy-mm-dd`
 * strings because that is what an `<input type="date">` submits and converting
 * at the boundary rather than in the middle keeps the timezone question in one
 * place.
 */
export interface BookInDraft {
  registration: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  derivative: string | null;
  /**
   * How many derivatives the spec lookup returned for this registration.
   * Above one, the dealer must pick: a wrong derivative is a wrong price and a
   * mis-described vehicle, which is a Consumer Rights Act problem.
   */
  derivativeCandidateCount: number;
  colour: string | null;
  fuelType: string | null;
  mileage: number | null;
  /** The highest odometer reading in the MOT history, if we have one. */
  highestMotMileage: number | null;
  mileageAnomalyAcknowledged: boolean;
  firstRegisteredOn: string | null;
  purchaseSource: PurchaseSource | null;
  purchaseDate: string | null;
  purchasePricePence: bigint | null;
  vatScheme: VatScheme | null;
  retailPricePence: bigint | null;
}

export type ProblemSeverity = 'error' | 'warning';

export interface BookInProblem {
  field: keyof BookInDraft;
  code: string;
  severity: ProblemSeverity;
  /** Says what is wrong AND what to do. "An error occurred" is banned. */
  message: string;
}

export interface BookInAssessment {
  /** No errors. Warnings do not block — they are work still to do. */
  ok: boolean;
  problems: BookInProblem[];
  errors: BookInProblem[];
  warnings: BookInProblem[];
  /** The registration as it will be stored, if it is usable at all. */
  normalisedRegistration: string | null;
}

/**
 * An implausibly high reading is almost always a typo — an extra digit on a
 * six-figure mileage. Warn rather than block: a genuine 500,000-mile taxi
 * exists and refusing to record it would be wrong.
 */
const IMPLAUSIBLE_MILEAGE = 500_000;

/** The oldest a first-registration date can sensibly be. Cars predate this; UK plates do not. */
const EARLIEST_REGISTRATION_YEAR = 1900;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Everything wrong with this book-in, as a list.
 *
 * A list rather than a boolean for the same reason `goLiveBlockers` returns
 * one: "4 things to fix" beside the fields that need fixing beats a disabled
 * button that will not say why.
 *
 * `now` is a required argument, not `new Date()` inside. A function that reads
 * the clock cannot be tested at a boundary, and every date rule here is a
 * boundary.
 */
export function assessBookIn(draft: BookInDraft, now: Date): BookInAssessment {
  const problems: BookInProblem[] = [];
  const today = isoDay(now);

  const push = (
    field: keyof BookInDraft, code: string, severity: ProblemSeverity, message: string,
  ): void => {
    problems.push({ field, code, severity, message });
  };

  // ---------------------------------------------------------- identity
  const registration = draft.registration.trim();
  let normalisedRegistration: string | null = null;

  if (registration === '') {
    push('registration', 'registration_missing', 'error',
      'Enter the registration. It is how every lookup, the stock book and the invoice find this car.');
  } else if (!isPlausibleRegistration(registration)) {
    push('registration', 'registration_implausible', 'error',
      `"${registration}" is not a registration we recognise. UK plates are 2 to 8 letters and `
      + 'numbers — check for a stray character.');
  } else {
    normalisedRegistration = normaliseRegistration(registration);
  }

  if (draft.vin !== null && draft.vin.trim() !== '' && draft.vin.trim().length !== 17) {
    // A VIN is 17 characters by ISO 3779. Pre-1981 cars have shorter chassis
    // numbers, so this is a warning — the field takes either.
    push('vin', 'vin_length', 'warning',
      `That VIN is ${draft.vin.trim().length} characters and a modern VIN is 17. `
      + 'Fine for a pre-1981 chassis number — worth a second look otherwise.');
  }

  if (!draft.make || !draft.model) {
    push('make', 'no_make_model', 'warning',
      'No make and model yet. Run the registration lookup, or type them in — the car cannot be '
      + 'advertised or invoiced without them.');
  }

  // ------------------------------------------------------- derivative
  //
  // Never guess. Multiple trims share one DVLA record, and the derivative is
  // what sets the price and the description.
  if (draft.derivativeCandidateCount > 1 && !draft.derivative) {
    push('derivative', 'derivative_ambiguous', 'error',
      `The lookup returned ${draft.derivativeCandidateCount} derivatives for this registration. `
      + 'Pick the one that matches the car — we will not guess, because the wrong derivative is '
      + 'the wrong price and a mis-described vehicle.');
  }

  // ---------------------------------------------------------- mileage
  if (draft.mileage !== null) {
    if (draft.mileage < 0) {
      push('mileage', 'mileage_negative', 'error', 'Mileage cannot be negative. Enter the reading from the odometer.');
    } else if (draft.mileage > IMPLAUSIBLE_MILEAGE) {
      push('mileage', 'mileage_implausible', 'warning',
        `${draft.mileage.toLocaleString('en-GB')} miles is unusually high — check for an extra digit.`);
    }

    if (
      draft.highestMotMileage !== null
      && draft.mileage < draft.highestMotMileage
      && !draft.mileageAnomalyAcknowledged
    ) {
      push('mileage', 'mileage_anomaly', 'error',
        `The MOT history records ${draft.highestMotMileage.toLocaleString('en-GB')} miles, which is `
        + `higher than the ${draft.mileage.toLocaleString('en-GB')} you have entered. Correct the `
        + 'reading, or tick to confirm it is right and you have checked why.');
    }
  }

  // ------------------------------------------------------------ dates
  if (draft.firstRegisteredOn) {
    const year = Number(draft.firstRegisteredOn.slice(0, 4));
    if (draft.firstRegisteredOn > today) {
      push('firstRegisteredOn', 'first_registered_future', 'error',
        'The first registration date is in the future. Check the V5C.');
    } else if (Number.isFinite(year) && year < EARLIEST_REGISTRATION_YEAR) {
      push('firstRegisteredOn', 'first_registered_implausible', 'warning',
        `First registered ${year} — check the V5C, that is earlier than UK registration records go.`);
    }
  }

  if (draft.purchaseDate && draft.purchaseDate > today) {
    push('purchaseDate', 'purchase_date_future', 'error',
      'The purchase date is in the future. The VAT stock book records when you actually bought the car.');
  }

  // ------------------------------------------------------------ money
  if (draft.purchasePricePence !== null && draft.purchasePricePence < 0n) {
    push('purchasePricePence', 'purchase_price_negative', 'error',
      'The purchase price cannot be negative.');
  }
  if (draft.retailPricePence !== null && draft.retailPricePence < 0n) {
    push('retailPricePence', 'retail_price_negative', 'error',
      'The retail price cannot be negative.');
  }

  // The stock book needs the purchase price, the date and the seller. Missing
  // them does not stop a book-in — it stops going live, and `goLiveBlockers`
  // says so there. Flagged here so the dealer knows the work is outstanding.
  if (draft.purchasePricePence === null) {
    push('purchasePricePence', 'no_purchase_price', 'warning',
      'No purchase price. The VAT stock book needs it, and without it there is no margin to report.');
  }
  if (!draft.purchaseSource) {
    push('purchaseSource', 'no_purchase_source', 'warning',
      'Record where the car came from — it decides the VAT scheme and it is a stock book field.');
  }
  if (!draft.purchaseDate) {
    push('purchaseDate', 'no_purchase_date', 'warning',
      'No purchase date. It is one of the twelve mandatory VAT stock book fields.');
  }

  // ------------------------------------------------------- VAT scheme
  //
  // A warning, not an error. The scheme must be settled before the car goes
  // live and before anything is invoiced, and both of those gates enforce it.
  // Demanding it at book-in would mean a dealer standing in an auction hall
  // cannot record a car until they have read the invoice they have not been
  // given yet — so they would put a scheme in to get past the screen, which is
  // strictly worse than leaving it blank and being asked again.
  if (!draft.vatScheme) {
    const suggestion = suggestVatScheme(draft.purchaseSource);
    push('vatScheme', 'no_vat_scheme', 'warning',
      suggestion.suggested
        ? `VAT scheme not set. ${suggestion.reason}`
        : 'VAT scheme not set. It must be decided before this car can go live, and it cannot be '
          + 'changed once a sale is invoiced.');
  }

  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');

  return {
    ok: errors.length === 0,
    problems,
    errors,
    warnings,
    normalisedRegistration,
  };
}

// -------------------------------------------------------- money at the edge

export type PoundsParse =
  | { ok: true; pence: bigint | null }
  | { ok: false; message: string };

/**
 * A pounds-and-pence string from a form input, as integer pence.
 *
 * This exists because the alternative — `Math.round(parseFloat(v) * 100)` in a
 * form handler — is rule 2 being broken in the one place nobody looks. Binary
 * floating point cannot hold 12.10, so `parseFloat('8995.10') * 100` is
 * 899509.9999999999, and a purchase price a penny light is a margin a penny
 * wrong on a figure HMRC checks.
 *
 * So the string is split on the decimal point and each side parsed as an
 * integer. No float is constructed at any point.
 *
 * Empty input is `null`, not zero: a dealer who has not entered a purchase
 * price has not told us it was free, and `goLiveBlockers` and the stock book
 * both need to tell those apart.
 */
export function parsePoundsToPence(input: string): PoundsParse {
  // Strip the things a person types: a currency symbol, thousands separators,
  // and the spaces around them.
  const cleaned = input.trim().replace(/[£,\s]/g, '');
  if (cleaned === '') return { ok: true, pence: null };

  const match = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match || (match[2] === '' && match[3] === undefined)) {
    return {
      ok: false,
      message: `"${input.trim()}" is not an amount. Enter pounds and pence, like 8995 or 8995.50.`,
    };
  }
  if (match[1] === '-') {
    return { ok: false, message: 'Enter a positive amount.' };
  }

  const pounds = BigInt(match[2] || '0');
  // '8995.5' means 50p, not 5p — pad rather than parse the fraction as written.
  const pence = BigInt((match[3] ?? '').padEnd(2, '0'));

  return { ok: true, pence: pounds * 100n + pence };
}

// ------------------------------------------------------------ repricing

export interface RepriceResult {
  ok: boolean;
  /** Present when `ok` is false. Says what to do. */
  message?: string;
  /** Signed change in pence. Negative is a price drop. */
  deltaPence?: bigint;
}

/**
 * A price change, checked before it is appended.
 *
 * `vehicle_prices` is append-only, so this runs before the insert rather than
 * validating a mutation. The no-change case is refused rather than silently
 * ignored: appending an identical price writes a history row that says a
 * dealer repriced a car when they did not, and the price-drop badge on the
 * public site reads that history.
 */
export function validateReprice(
  currentPence: bigint | null,
  nextPence: bigint,
): RepriceResult {
  if (nextPence < 0n) {
    return { ok: false, message: 'A price cannot be negative.' };
  }
  if (nextPence === 0n) {
    return {
      ok: false,
      message: 'A retail price of £0 would publish the car as free. Set a real price, or take the '
        + 'car off sale by moving it out of Live.',
    };
  }
  if (currentPence !== null && currentPence === nextPence) {
    return { ok: false, message: 'That is the price it is already at.' };
  }
  return { ok: true, deltaPence: nextPence - (currentPence ?? 0n) };
}
