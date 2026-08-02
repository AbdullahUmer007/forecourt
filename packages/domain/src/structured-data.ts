/**
 * M6a — JSON-LD structured data.
 *
 * The competitor's live customer site had NONE. No Vehicle, no Offer, no
 * AutoDealer, no LocalBusiness. The consequence is that their listings compete
 * for attention as plain blue text against results showing a photograph, a
 * price and an availability badge — and they are ineligible for Google's
 * vehicle listing formats entirely.
 *
 * This is free, invisible, and one of the highest-leverage things on the page.
 */

import type { VehicleUrlParts } from './seo.js';

export type JsonLd = Record<string, unknown>;

// ---------------------------------------------------------------- vehicle

export interface StructuredVehicle extends VehicleUrlParts {
  vin: string | null;
  mileage: number | null;
  mileageUnit: 'SMI' | 'KMT';
  pricePence: bigint | null;
  currency: string;
  colour: string | null;
  fuelType: string | null;
  transmission: string | null;
  bodyStyle: string | null;
  doors: number | null;
  seats: number | null;
  engineCc: number | null;
  powerBhp: number | null;
  co2Gkm: number | null;
  formerKeepers: number | null;
  state: string;
  imageUrls: readonly string[];
  description: string | null;
  url: string;
}

export interface StructuredDealer {
  name: string;
  url: string;
  logoUrl: string | null;
  telephone: string | null;
  email: string | null;
  street: string;
  locality: string;
  region: string | null;
  postcode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  openingHours: readonly { days: readonly string[]; opens: string; closes: string }[];
  ratingValue: number | null;
  reviewCount: number | null;
  priceRange: string | null;
}

const AVAILABILITY: Record<string, string> = {
  live: 'https://schema.org/InStock',
  reserved: 'https://schema.org/LimitedAvailability',
  sold: 'https://schema.org/SoldOut',
  delivered: 'https://schema.org/SoldOut',
};

const FUEL: Record<string, string> = {
  petrol: 'Petrol', diesel: 'Diesel', electricity: 'Electric', electric: 'Electric',
  hybrid: 'Hybrid', 'hybrid electric': 'Hybrid', 'plug-in hybrid': 'Plug-in Hybrid',
};

const money = (pence: bigint): string => (Number(pence) / 100).toFixed(2);
const defined = <T extends JsonLd>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '')) as T;

/**
 * `Car` (a subtype of `Vehicle`) with a nested `Offer`.
 *
 * Deliberately omits any finance figure. A monthly payment in structured data
 * is still a financial promotion under CONC 3.5.3R, and structured data has
 * nowhere to carry the representative example — so it must not appear at all.
 */
export function vehicleJsonLd(v: StructuredVehicle, dealer: StructuredDealer): JsonLd {
  const name = [v.year, v.make, v.model, v.derivative].filter(Boolean).join(' ');

  return defined({
    '@context': 'https://schema.org',
    '@type': 'Car',
    name,
    url: v.url,
    ...(v.description ? { description: v.description } : {}),
    ...(v.vin ? { vehicleIdentificationNumber: v.vin } : {}),
    ...(v.imageUrls.length ? { image: [...v.imageUrls] } : {}),
    ...(v.make ? { brand: { '@type': 'Brand', name: v.make } } : {}),
    ...(v.model ? { model: v.model } : {}),
    ...(v.year ? { vehicleModelDate: String(v.year), productionDate: String(v.year) } : {}),
    ...(v.colour ? { color: v.colour } : {}),
    ...(v.bodyStyle ? { bodyType: v.bodyStyle } : {}),
    ...(v.doors ? { numberOfDoors: v.doors } : {}),
    ...(v.seats ? { seatingCapacity: v.seats } : {}),
    ...(v.formerKeepers !== null ? { numberOfPreviousOwners: v.formerKeepers } : {}),
    ...(v.fuelType ? { fuelType: FUEL[v.fuelType.toLowerCase()] ?? v.fuelType } : {}),
    ...(v.transmission ? { vehicleTransmission: v.transmission } : {}),
    ...(v.mileage !== null
      ? { mileageFromOdometer: { '@type': 'QuantitativeValue', value: v.mileage, unitCode: v.mileageUnit } }
      : {}),
    ...(v.engineCc || v.powerBhp
      ? {
          vehicleEngine: defined({
            '@type': 'EngineSpecification',
            ...(v.engineCc ? { engineDisplacement: { '@type': 'QuantitativeValue', value: v.engineCc, unitCode: 'CMQ' } } : {}),
            ...(v.powerBhp ? { enginePower: { '@type': 'QuantitativeValue', value: v.powerBhp, unitCode: 'BHP' } } : {}),
          }),
        }
      : {}),
    ...(v.co2Gkm !== null
      ? { emissionsCO2: { '@type': 'QuantitativeValue', value: v.co2Gkm, unitCode: 'F63' } }
      : {}),
    itemCondition: 'https://schema.org/UsedCondition',
    offers: defined({
      '@type': 'Offer',
      ...(v.pricePence !== null ? { price: money(v.pricePence), priceCurrency: v.currency } : {}),
      availability: AVAILABILITY[v.state] ?? 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/UsedCondition',
      url: v.url,
      seller: { '@type': 'AutoDealer', name: dealer.name, url: dealer.url },
    }),
  });
}

// ---------------------------------------------------------------- dealer

export function dealerJsonLd(d: StructuredDealer): JsonLd {
  return defined({
    '@context': 'https://schema.org',
    // AutoDealer is a subtype of LocalBusiness, so one node satisfies both.
    '@type': 'AutoDealer',
    name: d.name,
    url: d.url,
    ...(d.logoUrl ? { logo: d.logoUrl, image: d.logoUrl } : {}),
    ...(d.telephone ? { telephone: d.telephone } : {}),
    ...(d.email ? { email: d.email } : {}),
    ...(d.priceRange ? { priceRange: d.priceRange } : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: d.street,
      addressLocality: d.locality,
      ...(d.region ? { addressRegion: d.region } : {}),
      postalCode: d.postcode,
      addressCountry: d.country,
    },
    ...(d.latitude !== null && d.longitude !== null
      ? { geo: { '@type': 'GeoCoordinates', latitude: d.latitude, longitude: d.longitude } }
      : {}),
    ...(d.openingHours.length
      ? {
          openingHoursSpecification: d.openingHours.map((h) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: [...h.days],
            opens: h.opens,
            closes: h.closes,
          })),
        }
      : {}),
    // Only emit a rating when there is a real one. An invented or zero-count
    // aggregateRating is a structured-data violation and can earn a penalty.
    ...(d.ratingValue !== null && d.reviewCount !== null && d.reviewCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: d.ratingValue,
            reviewCount: d.reviewCount,
            bestRating: 5,
          },
        }
      : {}),
  });
}

// ---------------------------------------------------------------- breadcrumbs

export interface Crumb { name: string; url: string }

export const breadcrumbJsonLd = (crumbs: readonly Crumb[]): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: c.url,
  })),
});

export function vehicleBreadcrumbs(origin: string, v: VehicleUrlParts, vehicleUrl: string): Crumb[] {
  const crumbs: Crumb[] = [{ name: 'Home', url: origin }, { name: 'Used cars', url: `${origin}/used-cars` }];
  if (v.make) crumbs.push({ name: v.make, url: `${origin}/used-cars/${v.make.toLowerCase().replace(/\s+/g, '-')}` });
  crumbs.push({ name: [v.year, v.make, v.model, v.derivative].filter(Boolean).join(' '), url: vehicleUrl });
  return crumbs;
}

// ---------------------------------------------------------------- item list

/** Search results as an ItemList, so Google understands the page is a listing. */
export const searchResultsJsonLd = (
  items: readonly { url: string; name: string }[],
): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  numberOfItems: items.length,
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem', position: i + 1, url: it.url, name: it.name,
  })),
});

// ---------------------------------------------------------------- rendering

/**
 * Render for embedding in a `<script type="application/ld+json">`.
 *
 * `<` is escaped so a description containing markup cannot close the script
 * tag early — that is an XSS vector, not a formatting nicety.
 */
export const renderJsonLd = (data: JsonLd | readonly JsonLd[]): string =>
  JSON.stringify(data).replace(/</g, '\\u003c');

/**
 * Guard used by the page renderer and asserted in tests: structured data must
 * never carry a cost-of-credit figure, because there is nowhere in JSON-LD to
 * attach the representative example that CONC 3.5.3R requires alongside it.
 */
export function assertNoFinanceFigures(data: JsonLd | readonly JsonLd[]): void {
  const json = JSON.stringify(data);
  const offenders = [
    /"monthlyPayment"/i,
    /"apr"/i,
    /per\s*month/i,
    /\bpcm\b/i,
    /representativeApr/i,
  ].filter((re) => re.test(json));
  if (offenders.length > 0) {
    throw new Error(
      'Structured data must not contain finance figures. A monthly payment or APR is a financial ' +
        'promotion under CONC 3.5.3R and requires a representative example alongside it, which ' +
        'JSON-LD cannot carry. Render finance only through <FinancePromotion>.',
    );
  }
}
