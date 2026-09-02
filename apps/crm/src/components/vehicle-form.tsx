'use client';

import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { bookInVehicle, updateVehicle } from '@/data/vehicle-actions';
import type { VehicleOutcome } from '@/data/vehicle-apply';
import type { SiteOption } from '@/data/stock';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/styles';
import {
  PURCHASE_SOURCES,
  PURCHASE_SOURCE_LABELS,
  suggestVatScheme,
  type PurchaseSource,
// The barrel would drag node:crypto into the browser bundle; the lint rule
// that says so is right. This module is pure string and enum work.
} from '@forecourt/domain/vehicle-intake';

/**
 * Booking a car in, and editing one.
 *
 * One component for both, because they are the same form. A dealer standing in
 * an auction hall records a registration and a hammer price; the rest is
 * filled in on Tuesday at a desk. If those were two different screens the
 * second one would be the one nobody could find.
 *
 * The design consequence is that almost nothing is `required` in the markup.
 * The domain decides what blocks a book-in (`assessBookIn`) and what blocks
 * advertising (`goLiveBlockers`), and they are deliberately different lists.
 * Browser-level `required` on a field the server is happy to accept would be a
 * third, invisible rule.
 *
 * The VAT scheme is the one control worth reading carefully. It is never
 * pre-selected from the purchase source — the source is evidence, not proof,
 * and a pre-ticked radio is a guess wearing the dealer's signature. What the
 * source does is put its own reasoning on screen beside the choice.
 */

const VAT_SCHEMES = [
  { value: 'margin', label: 'Margin scheme', hint: 'No VAT was recoverable when you bought it. The invoice must not show VAT separately.' },
  { value: 'qualifying', label: 'VAT qualifying', hint: 'You reclaimed input VAT. VAT is charged and shown on the full selling price.' },
  { value: 'non_qualifying', label: 'Non-qualifying', hint: 'Neither — rare, and usually a mistake. Check the purchase invoice first.' },
] as const;

const BOOK_IN_STATES = [
  { value: 'purchased', label: 'Purchased', hint: 'Bought, not with you yet' },
  { value: 'in_transit', label: 'In transit', hint: 'On its way to the forecourt' },
  { value: 'booked_in', label: 'Booked in', hint: 'Physically here — starts the days-in-stock clock' },
] as const;

export interface VehicleFormValues {
  vehicleId?: string;
  siteId: string;
  registration: string;
  vin: string;
  make: string;
  model: string;
  derivative: string;
  derivativeCandidateCount: number;
  colour: string;
  fuelType: string;
  bodyStyle: string;
  transmission: string;
  doors: string;
  engineCc: string;
  mileage: string;
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
  mileageAcknowledged: boolean;
}

export function VehicleForm({
  mode,
  values,
  sites,
  canSeeCost,
  canSetPrice,
}: {
  mode: 'book-in' | 'edit';
  values: VehicleFormValues;
  sites: readonly SiteOption[];
  /** Cost fields are not rendered at all for a role without them — not hidden. */
  canSeeCost: boolean;
  /** On edit the price moves to its own action, so the field is not offered here. */
  canSetPrice: boolean;
}) {
  const action = mode === 'book-in' ? bookInVehicle : updateVehicle;
  const [state, formAction] = useActionState<VehicleOutcome | null, FormData>(action, null);

  // What to put in the fields. After a rejected submission that is what the
  // dealer typed, not what the page was first rendered with — see the note on
  // `submitted` in VehicleOutcome. React resets the form to `defaultValue`
  // when the action resolves, so handing it the submitted values is what makes
  // the reset restore the work rather than destroy it.
  const shown: VehicleFormValues = state && !state.ok && state.submitted
    ? {
      ...values,
      ...state.submitted,
      // Not in the submitted record: these are structural, not typed.
      derivativeCandidateCount: values.derivativeCandidateCount,
      mileageAcknowledged: state.submitted.acknowledgeMileage !== '',
    }
    : values;

  const [source, setSource] = useState(shown.purchaseSource);
  const suggestion = suggestVatScheme(
    (source === '' ? null : source) as PurchaseSource | null,
  );

  // Field → first error, so a message lands beside the input it belongs to
  // rather than only in a summary at the top the dealer has scrolled past.
  const errors = new Map<string, string>();
  if (state && !state.ok) {
    for (const p of state.problems) {
      if (!errors.has(p.field)) errors.set(p.field, p.message);
    }
  }

  return (
    <form action={formAction} className="grid gap-6">
      {shown.vehicleId && <input type="hidden" name="vehicleId" value={shown.vehicleId} />}
      <input
        type="hidden"
        name="derivativeCandidateCount"
        value={shown.derivativeCandidateCount}
      />
      <input type="hidden" name="highestMotMileage" value={shown.highestMotMileage} />
      {mode === 'edit' && <input type="hidden" name="state" value={shown.state} />}

      {state && !state.ok && (
        <div role="alert" className="rounded-md border border-critical/40 bg-surface-1 p-4">
          <h2 className="flex items-center gap-2 text-[16px] leading-6 font-semibold text-critical">
            <span aria-hidden="true">✕</span> {state.error}
          </h2>
          {state.problems.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-ink-muted">
              {state.problems.map((p) => <li key={p.code}>{p.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ------------------------------------------------------- the car */}
      <Section
        title="The car"
        hint="The registration is the only thing we need to start. Everything else can follow."
      >
        <Field
          name="registration"
          label="Registration"
          error={errors.get('registration')}
          defaultValue={shown.registration}
          className="mono uppercase"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          placeholder="WN22 HNL"
        />
        <Field name="vin" label="VIN" error={errors.get('vin')} defaultValue={shown.vin}
          className="mono" maxLength={17} placeholder="WVWZZZAUZNW123456" />
        <Field name="make" label="Make" error={errors.get('make')} defaultValue={shown.make} placeholder="Volkswagen" />
        <Field name="model" label="Model" defaultValue={shown.model} placeholder="Golf" />
        <Field
          name="derivative"
          label="Derivative"
          error={errors.get('derivative')}
          defaultValue={shown.derivative}
          placeholder="1.5 TSI EVO Match 5dr"
          hint={shown.derivativeCandidateCount > 1
            ? `The lookup found ${shown.derivativeCandidateCount} trims for this plate — pick the right one.`
            : 'The trim level. It sets the price and the description, so it is worth getting right.'}
        />
        <Field name="colour" label="Colour" defaultValue={shown.colour} placeholder="Reflex Silver" />
        <Field name="fuelType" label="Fuel" defaultValue={shown.fuelType} placeholder="Petrol" />
        <Field name="bodyStyle" label="Body style" defaultValue={shown.bodyStyle} placeholder="Hatchback" />
        <Field name="transmission" label="Transmission" defaultValue={shown.transmission} placeholder="Manual" />
        <Field name="doors" label="Doors" defaultValue={shown.doors} inputMode="numeric" placeholder="5" />
        <Field name="engineCc" label="Engine (cc)" defaultValue={shown.engineCc} inputMode="numeric" placeholder="1498" />
        <Field name="firstRegisteredOn" label="First registered" type="date"
          error={errors.get('firstRegisteredOn')} defaultValue={shown.firstRegisteredOn} />
        <Field name="motExpiresOn" label="MOT expires" type="date" defaultValue={shown.motExpiresOn} />
        <Field name="formerKeepers" label="Former keepers" defaultValue={shown.formerKeepers}
          inputMode="numeric" placeholder="2" />
      </Section>

      {/* ------------------------------------------------------- mileage */}
      <Section
        title="Mileage"
        hint={shown.highestMotMileage !== ''
          ? `The MOT history records a highest reading of ${Number(shown.highestMotMileage).toLocaleString('en-GB')} miles.`
          : 'No MOT history on file yet, so we cannot check this against the record.'}
      >
        <Field
          name="mileage"
          label="Mileage"
          error={errors.get('mileage')}
          defaultValue={shown.mileage}
          inputMode="numeric"
          placeholder="42000"
        />
        <label className="flex items-start gap-2 sm:col-span-2">
          <input
            type="checkbox"
            name="acknowledgeMileage"
            defaultChecked={shown.mileageAcknowledged}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span className="text-ink-muted">
            The reading is below the MOT history and I have checked why.{' '}
            <span className="text-ink-subtle">
              Only tick this if it is genuinely correct — a reading below the record is a
              fraud signal and a Consumer Rights Act exposure, and ticking it puts your name on it.
            </span>
          </span>
        </label>
      </Section>

      {/* -------------------------------------------------- how you bought it */}
      {canSeeCost && (
        <Section title="How you bought it" hint="These are VAT stock book fields. They must be right before the car is invoiced.">
          {sites.length > 1 && (
            <Select name="siteId" label="Site" defaultValue={shown.siteId}
              options={sites.map((s) => ({ value: s.id, label: s.name }))} />
          )}
          <Select
            /*
             * Keyed on the value it should show, to force a remount when a
             * rejected submission hands back a different one. React applies
             * `defaultValue` to a <select> only on mount — unlike an <input>,
             * where it keeps the value attribute in step — so without this the
             * post-action reset restores the ORIGINAL default and silently
             * clears the dealer's choice of purchase source.
             */
            key={`purchaseSource:${shown.purchaseSource}`}
            name="purchaseSource"
            label="Bought from"
            defaultValue={shown.purchaseSource}
            onChange={setSource}
            error={errors.get('purchaseSource')}
            options={[
              { value: '', label: 'Not recorded yet' },
              ...PURCHASE_SOURCES.map((s) => ({ value: s, label: PURCHASE_SOURCE_LABELS[s] })),
            ]}
          />
          <Field name="purchaseDate" label="Purchase date" type="date"
            error={errors.get('purchaseDate')} defaultValue={shown.purchaseDate} />
          <Field name="purchasePrice" label="Purchase price" error={errors.get('purchasePricePence')}
            defaultValue={shown.purchasePrice} inputMode="decimal" prefix="£" placeholder="8995.00" />
        </Section>
      )}
      {sites.length > 1 && !canSeeCost && (
        <Section title="Where it is">
          <Select name="siteId" label="Site" defaultValue={shown.siteId}
            options={sites.map((s) => ({ value: s.id, label: s.name }))} />
        </Section>
      )}
      {sites.length <= 1 && <input type="hidden" name="siteId" value={shown.siteId} />}

      {/* ---------------------------------------------------- VAT scheme */}
      <Section
        title="VAT scheme"
        hint="Decided at book-in from the purchase invoice, and frozen once the car is sold. Getting it wrong makes the whole sale standard-rated."
      >
        <div className="grid gap-2 sm:col-span-2">
          {suggestion.reason && (
            <p className={`rounded-md border p-3 text-[13px] leading-[18px] ${
              suggestion.confident
                ? 'border-good/40 bg-surface-1 text-ink-muted'
                : 'border-edge bg-surface-3 text-ink-muted'
            }`}>
              <span aria-hidden="true">{suggestion.confident ? '✓' : 'i'}</span>{' '}
              {suggestion.reason}
            </p>
          )}
          {VAT_SCHEMES.map((scheme) => (
            <label key={scheme.value} className="flex min-h-11 items-start gap-2">
              <input
                type="radio"
                name="vatScheme"
                value={scheme.value}
                defaultChecked={shown.vatScheme === scheme.value}
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>
                <span className="font-medium">{scheme.label}</span>
                <span className="block text-[13px] leading-[18px] text-ink-subtle">{scheme.hint}</span>
              </span>
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="vatScheme" value=""
              defaultChecked={shown.vatScheme === ''} className="h-5 w-5 shrink-0" />
            <span className="text-ink-muted">
              Not decided yet — I will set it before the car goes live
            </span>
          </label>
          {errors.get('vatScheme') && (
            <p role="alert" className="text-[13px] leading-[18px] text-critical">
              {errors.get('vatScheme')}
            </p>
          )}
        </div>
      </Section>

      {/* ------------------------------------------------------- selling */}
      <Section title="Selling it" hint="All optional now. A retail price is one of the things needed before the car can be advertised.">
        {canSetPrice && (
          <Field name="retailPrice" label="Retail price" error={errors.get('retailPricePence')}
            defaultValue={shown.retailPrice} inputMode="decimal" prefix="£" placeholder="12495.00" />
        )}
        <Field name="advertHeadline" label="Advert headline" defaultValue={shown.advertHeadline}
          maxLength={120} placeholder="One owner, full service history" />
        <TextArea name="advertDescription" label="Advert description"
          defaultValue={shown.advertDescription} rows={5} />
        <TextArea name="notes" label="Internal notes" defaultValue={shown.notes} rows={3}
          hint="Never shown to a customer or sent to a portal." />
      </Section>

      {/* --------------------------------------------------------- state */}
      {mode === 'book-in' && (
        <Section title="Where it is in the process">
          <div className="grid gap-2 sm:col-span-2">
            {BOOK_IN_STATES.map((s) => (
              <label key={s.value} className="flex min-h-11 items-start gap-2">
                <input type="radio" name="state" value={s.value}
                  defaultChecked={shown.state === s.value} className="mt-1 h-5 w-5 shrink-0" />
                <span>
                  <span className="font-medium">{s.label}</span>
                  <span className="block text-[13px] leading-[18px] text-ink-subtle">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Submit label={mode === 'book-in' ? 'Book the car in' : 'Save changes'} />
        <span className="text-[13px] leading-[18px] text-ink-subtle">
          {mode === 'book-in'
            ? 'You can fill the rest in later — nothing here is final.'
            : 'The price and the state are changed from the vehicle page.'}
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- pieces

function Section(
  { title, hint, children }: { title: string; hint?: string; children: React.ReactNode },
) {
  return (
    <section className="rounded-md border border-edge bg-surface-1">
      <header className="border-b border-edge px-4 py-3">
        <h2 className="text-[16px] leading-6 font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] leading-[18px] text-ink-subtle">{hint}</p>}
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/*
 * The shared field styling, not a second copy of it.
 *
 * These were declared locally and had already drifted from every other form
 * in the product — `rounded-sm` where the rest used `rounded-md`, and a label
 * in `ink-subtle` where the rest used `ink-muted`. A book-in form is the
 * longest thing a dealer fills in, so it was the screen where the drift
 * showed most.
 *
 * No focus styles in either: globals.css declares the ring once, for
 * everything.
 */
const LABEL = LABEL_CLASS;
const INPUT = INPUT_CLASS;

/*
 * `content-start` is load-bearing, not tidying.
 *
 * A field cell is a grid item in a two-column row, so it stretches to the
 * height of the taller neighbour. Its own rows are auto-sized, and auto rows
 * in a stretched grid container share out the slack — which pushes the input
 * downward by half the neighbour's hint text. The result is two inputs side by
 * side on the same row sitting at different heights: Derivative carries a hint
 * and Colour does not, so Colour's box floated 18px below its partner.
 *
 * Pinning the content to the top keeps the slack underneath, where it is
 * invisible, and every input on a row starts on the same line.
 */
const FIELD_CELL = 'grid content-start gap-1';

function Field({
  name, label, hint, error, prefix, className = '', ...rest
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  prefix?: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean).join(' ');

  return (
    <div className={FIELD_CELL}>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className={prefix ? 'flex items-center gap-0' : undefined}>
        {prefix && (
          <span aria-hidden="true"
            className="flex min-h-11 items-center rounded-l-sm border border-r-0 border-edge-strong bg-surface-3 px-3 text-ink-muted">
            {prefix}
          </span>
        )}
        <input
          {...rest}
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`${INPUT} ${prefix ? 'rounded-l-none' : ''} ${
            error ? 'border-critical' : ''
          } ${className}`}
        />
      </div>
      {hint && <p id={`${id}-hint`} className="text-[12px] leading-4 text-ink-subtle">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[12px] leading-4 text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

function TextArea(
  { name, label, hint, rows = 4, defaultValue }:
  { name: string; label: string; hint?: string; rows?: number; defaultValue?: string },
) {
  const id = useId();
  return (
    <div className={`${FIELD_CELL} sm:col-span-2`}>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className={
          'w-full rounded-md border border-edge-strong bg-surface-1 p-3 text-ink '
          + 'placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand-600'
        }
      />
      {hint && <p className="text-[12px] leading-4 text-ink-subtle">{hint}</p>}
    </div>
  );
}

/**
 * Uncontrolled, even where something on the page reacts to it.
 *
 * A controlled `<select>` does not survive this form. React resets an
 * uncontrolled form when its action resolves, and the reset writes straight to
 * the DOM — so a controlled select ends up showing "Not recorded yet" while
 * React still believes the dealer picked "Private seller". The next submission
 * then posts an empty purchase source, and on this form that decides the VAT
 * scheme. Reading `defaultValue` and reporting changes upward keeps the field
 * and the reset telling the same story.
 */
function Select({
  name, label, options, defaultValue, onChange, error,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  onChange?: (v: string) => void;
  error?: string | undefined;
}) {
  const id = useId();

  return (
    <div className={FIELD_CELL}>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        defaultValue={defaultValue}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={`${INPUT} ${error ? 'border-critical' : ''}`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p role="alert" className="text-[12px] leading-4 text-critical">{error}</p>}
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}
