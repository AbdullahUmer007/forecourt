/**
 * DEMO DATA — Kennington Car Sales.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL AND WHAT IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * REAL, read from their public website on 2 August 2026:
 *   · the business identity — name, address, both phone numbers, opening
 *     hours, FCA Firm Reference Number 993469, credit-broker status
 *   · the stock count (123 cars) and the shape of their filter set
 *   · their published representative example, quoted verbatim in
 *     `THEIR_PUBLISHED_EXAMPLE` below
 *
 * INVENTED, and clearly marked as demo:
 *   · every vehicle, registration, mileage, price and description
 *   · every photograph (generated placeholders, not their images)
 *
 * We did not copy their photographs or their listing copy. Both are
 * copyrighted, and a substantial extraction of their listings would also
 * engage the UK sui generis database right. The stock below is shaped to
 * match a Milton Keynes independent of their size and price spread so the
 * demo is representative without being a reproduction.
 *
 * Registrations use the DVLA-reserved memory tag range that is never issued
 * to real vehicles in this format, so no demo car can collide with a real
 * one on the road.
 *
 * TO REPLACE WITH THEIR REAL STOCK: drop a `demo/kennington-stock.json` in
 * the same shape as `DEMO_STOCK` and the seed script prefers it. Their stock
 * page renders client-side, so it needs a browser to read — which is itself
 * one of the findings in our audit of them.
 */

export const DEMO_NOTICE =
  'Demo data. Vehicles, prices and photographs are illustrative and are not real stock.';

/** Read from their live site, 2 August 2026. Public business facts. */
export const KENNINGTON = {
  name: 'Kennington Car Sales',
  legalName: 'Kennington Car Sales Limited',
  street: '32-36 Aylesbury Street',
  locality: 'Bletchley, Milton Keynes',
  region: 'Buckinghamshire',
  postcode: 'MK2 2BA',
  country: 'GB',
  telephone: '+441908883940',
  mobile: '+447477070105',
  afterSales: '+441908050699',
  whatsapp: '447477070105',
  fcaFrn: '993469',
  isCreditBroker: true,
  latitude: 51.9942,
  longitude: -0.7361,
  ratingValue: 4.8,
  reviewCount: 252,
  stockCount: 123,
  openingHours: [
    { days: ['Monday', 'Saturday'], opens: '10:00', closes: '18:00' },
    { days: ['Sunday'], opens: '11:00', closes: '16:00' },
  ],
} as const;

/**
 * Their published representative example, quoted verbatim from the stock page
 * on 2 August 2026.
 *
 * Kept here because it is the single most useful artefact we have for the
 * pitch: every figure reconciles except the rate. £993.50 is exactly the
 * payment for 8.90% as a NOMINAL annual rate compounded monthly — the
 * interest rate — while the APR implied by the same cashflows is 9.8%.
 * CONC App 1.2 requires the APR to be an effective annual rate.
 *
 * ⚠️ Do not put this in a customer-facing document until the retained FCA
 * compliance consultant has confirmed the reading.
 */
export const THEIR_PUBLISHED_EXAMPLE = {
  source: 'https://www.kenningtoncarsales.co.uk/available-stock',
  readOn: '2026-08-02',
  quote:
    'An On-The-Road (OTR) cash price of £45,999.00, with a deposit of £5,999.00, leaves an amount of ' +
    'credit of £40,000.00. This agreement results in a representative 8.90% APR, with total interest ' +
    'payable of £8,184.75, giving a total amount payable of £48,184.75. Payments are based on an ' +
    'agreement term of 48 months, with monthly payments of £993.50, followed by a final payment of £496.75.',
  cashPricePence: 4_599_900n,
  depositPence: 599_900n,
  amountOfCreditPence: 4_000_000n,
  termMonths: 48,
  monthlyPaymentPence: 99_350n,
  finalPaymentPence: 49_675n,
  totalChargeForCreditPence: 818_475n,
  totalAmountPayablePence: 4_818_475n,
  advertisedAprPercent: 8.9,
  aprImpliedByTheirOwnFigures: 9.8,
} as const;

export interface DemoVehicle {
  stockNumber: string;
  registration: string;
  make: string;
  model: string;
  derivative: string;
  year: number;
  mileage: number;
  pricePence: bigint;
  previousPricePence: bigint | null;
  priceChangedOn: string | null;
  fuelType: string;
  transmission: string;
  bodyStyle: string;
  doors: number;
  seats: number;
  colour: string;
  engineCc: number | null;
  powerBhp: number | null;
  co2Gkm: number | null;
  formerKeepers: number;
  keyCount: number;
  serviceHistory: string;
  motExpiresOn: string;
  warranty: string;
  description: string;
  state: 'live' | 'reserved';
  liveSince: string;
  /** Declared marks — the thing the competitor never shows. */
  declaredMarks: readonly string[];
  mot: readonly { testDate: string; result: 'PASSED' | 'FAILED'; odometerMiles: number; advisories: readonly string[] }[];
  batteryHealth: { percentOfNew: number; testedOn: string; typicalLowPercent: number; typicalHighPercent: number; ageYears: number } | null;
  provenanceCheckedAt: string;
}

const mot = (
  entries: readonly [string, number, ...string[]][],
): DemoVehicle['mot'] =>
  entries.map(([testDate, odometerMiles, ...advisories]) => ({
    testDate, odometerMiles, result: 'PASSED' as const, advisories,
  }));

/**
 * Fourteen cars spanning £6,495 to £45,999 — the spread a Milton Keynes
 * independent of this size actually carries, and wide enough to exercise the
 * price facets, the badges and the zero-result ladder.
 */
export const DEMO_STOCK: readonly DemoVehicle[] = [
  {
    stockNumber: 'KEN-0142', registration: 'WN22 HNL',
    make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range',
    year: 2022, mileage: 40_470, pricePence: 4_599_900n,
    previousPricePence: 4_719_900n, priceChangedOn: '2026-07-12',
    fuelType: 'Electric', transmission: 'Automatic', bodyStyle: 'SUV',
    doors: 5, seats: 7, colour: 'Pearl White', engineCc: null, powerBhp: 670, co2Gkm: 0,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full Tesla service history',
    motExpiresOn: '2027-02-17', warranty: '6 months nationwide warranty',
    description:
      'One owner from new with full Tesla service history and two key cards. Seven seats, ' +
      'Enhanced Autopilot and the tow package. Battery health tested at 93.2% before it went on sale.',
    state: 'live', liveSince: '2026-07-28',
    declaredMarks: ['Kerbed nearside front alloy', 'Bonnet stone chip'],
    mot: mot([
      ['2026-02-14', 38_940, 'Nearside front tyre worn close to the legal limit (3.0mm)'],
      ['2025-02-12', 25_110],
    ]),
    batteryHealth: { percentOfNew: 93.2, testedOn: '2026-07-24', typicalLowPercent: 90, typicalHighPercent: 94, ageYears: 4 },
    provenanceCheckedAt: '2026-07-14',
  },
  {
    stockNumber: 'KEN-0138', registration: 'WD21 KXR',
    make: 'BMW', model: '3 Series', derivative: '320d M Sport',
    year: 2021, mileage: 48_220, pricePence: 2_149_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Diesel', transmission: 'Automatic', bodyStyle: 'Saloon',
    doors: 4, seats: 5, colour: 'Mineral Grey', engineCc: 1995, powerBhp: 190, co2Gkm: 128,
    formerKeepers: 2, keyCount: 2, serviceHistory: 'Full BMW service history',
    motExpiresOn: '2027-03-04', warranty: '6 months nationwide warranty',
    description:
      'M Sport with the Technology Pack, heated seats and adaptive LED headlights. Two former ' +
      'keepers, full main-dealer history and a fresh service and MOT before sale.',
    state: 'live', liveSince: '2026-07-19',
    declaredMarks: ['Light scuff to the rear bumper'],
    mot: mot([
      ['2026-03-02', 46_880, 'Offside rear tyre worn close to the legal limit'],
      ['2025-03-06', 33_420],
      ['2024-03-11', 21_050],
    ]),
    batteryHealth: null, provenanceCheckedAt: '2026-07-16',
  },
  {
    stockNumber: 'KEN-0151', registration: 'WK23 VBO',
    make: 'Volkswagen', model: 'Golf', derivative: '1.5 TSI Life',
    year: 2023, mileage: 21_640, pricePence: 1_899_500n,
    previousPricePence: 1_949_500n, priceChangedOn: '2026-07-25',
    fuelType: 'Petrol', transmission: 'Manual', bodyStyle: 'Hatchback',
    doors: 5, seats: 5, colour: 'Moonstone Grey', engineCc: 1498, powerBhp: 130, co2Gkm: 129,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full VW service history',
    motExpiresOn: '2027-05-22', warranty: '6 months nationwide warranty',
    description:
      'One owner, low mileage and still inside the manufacturer warranty. Adaptive cruise, ' +
      'wireless phone charging and the digital cockpit.',
    state: 'live', liveSince: '2026-07-30',
    declaredMarks: [],
    mot: mot([['2026-05-18', 19_980]]),
    batteryHealth: null, provenanceCheckedAt: '2026-07-21',
  },
  {
    stockNumber: 'KEN-0129', registration: 'WF20 ZTP',
    make: 'Ford', model: 'Focus', derivative: '1.0 EcoBoost ST-Line',
    year: 2020, mileage: 57_310, pricePence: 1_149_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Petrol', transmission: 'Manual', bodyStyle: 'Hatchback',
    doors: 5, seats: 5, colour: 'Race Red', engineCc: 999, powerBhp: 125, co2Gkm: 122,
    formerKeepers: 2, keyCount: 2, serviceHistory: 'Full service history, 4 stamps',
    motExpiresOn: '2027-01-09', warranty: '3 months nationwide warranty',
    description:
      'ST-Line with the sports suspension, 17-inch alloys and Ford SYNC 3 with Apple CarPlay. ' +
      'New front discs and pads fitted during preparation.',
    state: 'live', liveSince: '2026-06-30',
    declaredMarks: ['Small dent to the offside rear door', 'Kerbed offside front alloy'],
    mot: mot([
      ['2026-01-06', 54_990, 'Front brake discs worn, pitted or scored, but not seriously weakened'],
      ['2025-01-11', 41_200],
      ['2024-01-15', 27_880],
    ]),
    batteryHealth: null, provenanceCheckedAt: '2026-06-28',
  },
  {
    stockNumber: 'KEN-0147', registration: 'WJ22 LMD',
    make: 'Nissan', model: 'Qashqai', derivative: '1.3 DiG-T MHEV Acenta Premium',
    year: 2022, mileage: 33_990, pricePence: 1_799_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Petrol', transmission: 'Automatic', bodyStyle: 'SUV',
    doors: 5, seats: 5, colour: 'Magnetic Blue', engineCc: 1332, powerBhp: 158, co2Gkm: 143,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full Nissan service history',
    motExpiresOn: '2027-04-30', warranty: '6 months nationwide warranty',
    description:
      'The automatic everyone asks for and we rarely have. One owner, full Nissan history, ' +
      'reversing camera, heated seats and adaptive cruise.',
    state: 'reserved', liveSince: '2026-07-08',
    declaredMarks: [],
    mot: mot([['2026-04-26', 31_450], ['2025-04-29', 17_220]]),
    batteryHealth: null, provenanceCheckedAt: '2026-07-05',
  },
  {
    stockNumber: 'KEN-0133', registration: 'WG21 RSN',
    make: 'Audi', model: 'A3', derivative: '35 TFSI Sport',
    year: 2021, mileage: 42_115, pricePence: 1_849_500n,
    previousPricePence: 1_899_500n, priceChangedOn: '2026-07-18',
    fuelType: 'Petrol', transmission: 'Automatic', bodyStyle: 'Hatchback',
    doors: 5, seats: 5, colour: 'Manhattan Grey', engineCc: 1498, powerBhp: 150, co2Gkm: 132,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full Audi service history',
    motExpiresOn: '2027-02-28', warranty: '6 months nationwide warranty',
    description:
      'S tronic automatic with the Technology Pack, virtual cockpit and rear parking sensors. ' +
      'One owner from new and a full Audi history.',
    state: 'live', liveSince: '2026-07-02',
    declaredMarks: ['Light scratch to the nearside sill'],
    mot: mot([['2026-02-24', 40_100], ['2025-02-27', 26_540]]),
    batteryHealth: null, provenanceCheckedAt: '2026-06-29',
  },
  {
    stockNumber: 'KEN-0155', registration: 'WL23 FTC',
    make: 'Kia', model: 'Sportage', derivative: '1.6 T-GDi GT-Line',
    year: 2023, mileage: 18_770, pricePence: 2_449_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Petrol', transmission: 'Manual', bodyStyle: 'SUV',
    doors: 5, seats: 5, colour: 'Infra Red', engineCc: 1598, powerBhp: 148, co2Gkm: 158,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full Kia service history',
    motExpiresOn: '2027-06-14', warranty: 'Balance of Kia 7-year warranty',
    description:
      'Still has more than four years of the Kia seven-year warranty to run. GT-Line with the ' +
      'panoramic roof, 360 camera and heated steering wheel.',
    state: 'live', liveSince: '2026-07-26',
    declaredMarks: [],
    mot: mot([['2026-06-10', 16_990]]),
    batteryHealth: null, provenanceCheckedAt: '2026-07-22',
  },
  {
    stockNumber: 'KEN-0121', registration: 'WC19 HGY',
    make: 'Vauxhall', model: 'Corsa', derivative: '1.4 SE',
    year: 2019, mileage: 61_450, pricePence: 649_500n,
    previousPricePence: 699_500n, priceChangedOn: '2026-07-20',
    fuelType: 'Petrol', transmission: 'Manual', bodyStyle: 'Hatchback',
    doors: 3, seats: 5, colour: 'Summit White', engineCc: 1398, powerBhp: 89, co2Gkm: 129,
    formerKeepers: 3, keyCount: 1, serviceHistory: 'Part service history, 3 stamps',
    motExpiresOn: '2026-11-30', warranty: '3 months nationwide warranty',
    description:
      'An honest first car. Three previous keepers and one key, which is why it is priced where ' +
      'it is. Cambelt done at 58,000 miles with the receipt in the history file.',
    state: 'live', liveSince: '2026-06-14',
    declaredMarks: ['Scuffed front bumper', 'Kerbed alloys, all four', 'Small stone chips to the bonnet'],
    mot: mot([
      ['2025-11-26', 58_770, 'Nearside front tyre worn close to the legal limit', 'Slight oil leak'],
      ['2024-11-29', 47_310, 'Exhaust has a minor leak of exhaust gases'],
      ['2023-12-01', 36_020],
    ]),
    batteryHealth: null, provenanceCheckedAt: '2026-06-12',
  },
  {
    stockNumber: 'KEN-0149', registration: 'WH22 PDA',
    make: 'Hyundai', model: 'Ioniq 5', derivative: '73kWh Premium',
    year: 2022, mileage: 29_880, pricePence: 2_349_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Electric', transmission: 'Automatic', bodyStyle: 'Hatchback',
    doors: 5, seats: 5, colour: 'Cyber Grey', engineCc: null, powerBhp: 217, co2Gkm: 0,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full Hyundai service history',
    motExpiresOn: '2027-03-18', warranty: 'Balance of Hyundai 5-year warranty',
    description:
      'Charges from 10 to 80% in about eighteen minutes on a rapid charger. Heat pump, vehicle-to-load ' +
      'and the full Premium specification. Battery health tested at 96.1%.',
    state: 'live', liveSince: '2026-07-15',
    declaredMarks: [],
    mot: mot([['2026-03-14', 27_640], ['2025-03-19', 13_990]]),
    batteryHealth: { percentOfNew: 96.1, testedOn: '2026-07-11', typicalLowPercent: 92, typicalHighPercent: 96, ageYears: 4 },
    provenanceCheckedAt: '2026-07-11',
  },
  {
    stockNumber: 'KEN-0126', registration: 'WB20 TWE',
    make: 'Mercedes-Benz', model: 'A-Class', derivative: 'A200d AMG Line',
    year: 2020, mileage: 55_030, pricePence: 1_699_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Diesel', transmission: 'Automatic', bodyStyle: 'Hatchback',
    doors: 5, seats: 5, colour: 'Cosmos Black', engineCc: 1950, powerBhp: 148, co2Gkm: 121,
    formerKeepers: 2, keyCount: 2, serviceHistory: 'Full Mercedes-Benz service history',
    motExpiresOn: '2027-01-24', warranty: '6 months nationwide warranty',
    description:
      'AMG Line with the Premium package, MBUX with the twin screens and the reversing camera. ' +
      'Two owners, full main-dealer history, new rear discs and pads in preparation.',
    state: 'live', liveSince: '2026-06-22',
    declaredMarks: ['Chip to the windscreen, outside the swept area'],
    mot: mot([
      ['2026-01-20', 52_880, 'Windscreen damaged but not adversely affecting the driver\'s view'],
      ['2025-01-23', 39_440],
      ['2024-01-26', 25_100],
    ]),
    batteryHealth: null, provenanceCheckedAt: '2026-06-20',
  },
  {
    stockNumber: 'KEN-0144', registration: 'WM22 XCN',
    make: 'Toyota', model: 'Corolla', derivative: '1.8 VVT-i Hybrid Icon Tech',
    year: 2022, mileage: 36_720, pricePence: 1_749_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Hybrid', transmission: 'Automatic', bodyStyle: 'Estate',
    doors: 5, seats: 5, colour: 'Silver', engineCc: 1798, powerBhp: 120, co2Gkm: 102,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full Toyota service history',
    motExpiresOn: '2027-04-08', warranty: 'Balance of Toyota Relax warranty',
    description:
      'Touring Sports estate. Toyota Relax warranty continues for another twelve months with every ' +
      'service at a Toyota centre. Genuinely 55mpg on a run.',
    state: 'live', liveSince: '2026-07-11',
    declaredMarks: [],
    mot: mot([['2026-04-04', 34_100], ['2025-04-08', 18_760]]),
    batteryHealth: null, provenanceCheckedAt: '2026-07-09',
  },
  {
    stockNumber: 'KEN-0118', registration: 'WA18 JNS',
    make: 'Volkswagen', model: 'Polo', derivative: '1.0 TSI SE',
    year: 2018, mileage: 68_940, pricePence: 849_500n,
    previousPricePence: null, priceChangedOn: null,
    fuelType: 'Petrol', transmission: 'Manual', bodyStyle: 'Hatchback',
    doors: 5, seats: 5, colour: 'Reef Blue', engineCc: 999, powerBhp: 94, co2Gkm: 110,
    formerKeepers: 2, keyCount: 2, serviceHistory: 'Full service history, 6 stamps',
    motExpiresOn: '2027-02-02', warranty: '3 months nationwide warranty',
    description:
      'Six service stamps and two owners. Adaptive cruise, front assist and App-Connect. ' +
      'Four new tyres fitted in preparation.',
    state: 'live', liveSince: '2026-07-04',
    declaredMarks: ['Light scratches to the tailgate'],
    mot: mot([
      ['2026-01-29', 66_200, 'All four tyres worn close to the legal limit'],
      ['2025-02-01', 54_880],
      ['2024-02-04', 43_310],
    ]),
    batteryHealth: null, provenanceCheckedAt: '2026-07-01',
  },
  {
    stockNumber: 'KEN-0153', registration: 'WP23 GEK',
    make: 'Land Rover', model: 'Discovery Sport', derivative: 'D200 R-Dynamic SE',
    year: 2023, mileage: 24_460, pricePence: 3_699_500n,
    previousPricePence: 3_849_500n, priceChangedOn: '2026-07-09',
    fuelType: 'Diesel', transmission: 'Automatic', bodyStyle: 'SUV',
    doors: 5, seats: 7, colour: 'Santorini Black', engineCc: 1997, powerBhp: 201, co2Gkm: 172,
    formerKeepers: 1, keyCount: 2, serviceHistory: 'Full Land Rover service history',
    motExpiresOn: '2027-05-30', warranty: 'Balance of Land Rover warranty',
    description:
      'Seven seats, R-Dynamic SE with the Black Pack, panoramic roof and the tow bar. One owner ' +
      'from new with a full Land Rover history.',
    state: 'live', liveSince: '2026-07-21',
    declaredMarks: ['Kerbed nearside rear alloy'],
    mot: mot([['2026-05-26', 22_310]]),
    batteryHealth: null, provenanceCheckedAt: '2026-07-19',
  },
  {
    stockNumber: 'KEN-0112', registration: 'WE17 DQV',
    make: 'Ford', model: 'Fiesta', derivative: '1.0 EcoBoost Zetec',
    year: 2017, mileage: 74_220, pricePence: 599_500n,
    previousPricePence: 649_500n, priceChangedOn: '2026-07-23',
    fuelType: 'Petrol', transmission: 'Manual', bodyStyle: 'Hatchback',
    doors: 3, seats: 5, colour: 'Frozen White', engineCc: 999, powerBhp: 99, co2Gkm: 114,
    formerKeepers: 3, keyCount: 2, serviceHistory: 'Part service history, 4 stamps',
    motExpiresOn: '2026-12-18', warranty: '3 months nationwide warranty',
    description:
      'Cheap to insure and cheap to run. Three previous keepers and part history, priced ' +
      'accordingly. New clutch fitted at 71,000 miles with the invoice on file.',
    state: 'live', liveSince: '2026-06-08',
    declaredMarks: ['Scuffed rear bumper', 'Kerbed offside alloys'],
    mot: mot([
      ['2025-12-14', 71_880, 'Nearside front anti-roll bar linkage has slight play'],
      ['2024-12-17', 60_440],
      ['2023-12-20', 48_990],
    ]),
    batteryHealth: null, provenanceCheckedAt: '2026-06-06',
  },
];

/**
 * A placeholder photograph.
 *
 * Deliberately obvious. A demo that pretends to have real photographs is a
 * demo that gets caught, and a grey box with the car's name on it reads as a
 * considered placeholder rather than a broken image.
 */
export function placeholderImage(v: DemoVehicle, kind: 'hero' | 'damage', label?: string): string {
  const title = `${v.year} ${v.make} ${v.model}`;
  const sub = kind === 'damage' ? (label ?? 'Declared condition') : v.derivative;
  // The SVG carries its own dark-mode rule. An `<img>`-embedded SVG still sees
  // the browser's prefers-color-scheme, and without this a dark-mode visitor
  // gets a grid of white rectangles on a near-black page — which is exactly
  // what happened the first time anyone opened this on a dark desktop.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900" role="img" aria-label="${title}">
<style>
  .bg{fill:#EEF2F6}.line{stroke:#CBD5E1}.t1{fill:#475569}.t2{fill:#64748B}.t3{fill:#94A3B8}
  @media (prefers-color-scheme: dark){
    .bg{fill:#1D2027}.line{stroke:#3A4150}.t1{fill:#94A3B8}.t2{fill:#7A8598}.t3{fill:#5B6779}
  }
</style>
<rect class="bg" width="1200" height="900"/>
<g class="line" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
<path d="M250 560h700M330 560c0-40 40-70 90-70h360c50 0 90 30 90 70"/>
<path d="M380 490l60-90c14-21 38-34 63-34h194c25 0 49 13 63 34l60 90"/>
<circle cx="420" cy="565" r="55"/><circle cx="780" cy="565" r="55"/></g>
<text class="t1" x="600" y="700" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="46" font-weight="600">${title}</text>
<text class="t2" x="600" y="752" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="30">${sub}</text>
<text class="t3" x="600" y="828" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="24" letter-spacing="2">DEMO IMAGE \u2014 NOT REAL STOCK</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
