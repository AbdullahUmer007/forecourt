import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  assertNoFinanceInFeed, publishBlockers, canPublish, delistDecision,
  payloadHash, shouldRepublish, feedIdempotencyKey,
  ADAPTERS, adapterFor, autoTraderAdapter, carGurusAdapter, metaCatalogueAdapter,
  previewFor, channelHealth, retryAfter, describeRetry, MAX_AUTO_RETRIES,
  totalMandatoryFees, CHANNEL_LABELS,
  type CanonicalVehicle, type ChannelKey, type ListingState, type ChannelPayload,
} from './feeds.js';
import { money } from './money.js';

const D = (day: number, hour = 12): Date => new Date(Date.UTC(2026, 7, day, hour));

const vehicle = (over: Partial<CanonicalVehicle> = {}): CanonicalVehicle => ({
  id: 'veh-1',
  registration: 'WN22HNL',
  vin: 'WBA1234567890XYZ',
  make: 'BMW', model: '3 Series', derivative: '320i M Sport 4dr Step Auto',
  bodyStyle: 'Saloon', doors: 4, seats: 5,
  transmission: 'Automatic', fuelType: 'Petrol', engineCc: 1998,
  colour: 'Mineral Grey', mileage: 42_500,
  firstRegisteredOn: new Date(Date.UTC(2022, 2, 14)),
  co2Gkm: 142,
  price: money(1_999_900n),
  vatScheme: 'margin',
  headline: 'One owner, full history',
  description: 'A tidy example with full service history.',
  features: ['Heated seats', 'Parking sensors'],
  photoUrls: Array.from({ length: 12 }, (_, i) => `https://cdn.test/${i}.jpg`),
  publishedPhotoCount: 12,
  state: 'live',
  provenanceCheckedAt: D(1),
  mandatoryFees: [],
  ...over,
});

const ALL_CHANNELS = Object.keys(ADAPTERS) as ChannelKey[];

// ============================================ THE compliance guard

describe('a cost-of-credit figure can never reach a feed', () => {
  // The rule this module exists to not break. A portal renders our payload on
  // their page, in their layout, with nowhere to attach the representative
  // example CONC 3.5.3R requires.

  it('refuses a monthly payment typed into the description, on EVERY channel', () => {
    const dodgy = vehicle({ description: 'Drive away for only £249 per month!' });
    for (const channel of ALL_CHANNELS) {
      expect(
        () => adapterFor(channel).map(dodgy),
        `${channel} accepted a monthly payment`,
      ).toThrow(/CONC 3\.5\.3R/);
    }
  });

  it('refuses an APR, a PCP mention, a deposit and "finance from"', () => {
    for (const text of [
      'Representative APR 9.9%',
      'PCP available',
      'Low deposit taken today',
      'Finance from £199',
      'Just £199 pcm',
      '£199 a month',
      'Interest rate fixed for the term',
    ]) {
      expect(() => autoTraderAdapter.map(vehicle({ description: text })), text)
        .toThrow(/Refusing to send a cost-of-credit figure/);
    }
  });

  it('catches it in the headline and in the feature list too, not just the description', () => {
    expect(() => autoTraderAdapter.map(vehicle({ headline: 'Only £199 per month' })))
      .toThrow(/cost-of-credit/);
    expect(() => autoTraderAdapter.map(vehicle({ features: ['Heated seats', '9.9% APR'] })))
      .toThrow(/cost-of-credit/);
  });

  it('does NOT fire on an ordinary cash price', () => {
    // A scanner that flags every number gets switched off within a week and
    // then protects nothing. Same reasoning as M8's language scanner.
    expect(() => autoTraderAdapter.map(vehicle({
      description: 'Priced at £19,999. Part-exchange welcome, 12 months MOT.',
    }))).not.toThrow();
  });

  it('does not fire on ordinary trade vocabulary', () => {
    for (const text of [
      'Full service history and two keys.',
      'Part-exchange welcome.',
      '12 months MOT on purchase.',
      'One owner from new, 42,500 miles.',
    ]) {
      expect(() => autoTraderAdapter.map(vehicle({ description: text })), text).not.toThrow();
    }
  });

  it('the refusal says what to do instead', () => {
    try {
      autoTraderAdapter.map(vehicle({ description: '£249 per month' }));
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/Auto Trader/);
      expect(message).toMatch(/advertise the cash price only/);
    }
  });

  it('assertNoFinanceInFeed can be called directly and is not adapter-specific', () => {
    const payload: ChannelPayload = { description: 'Only £199 PCM' };
    expect(() => assertNoFinanceInFeed(payload, 'cargurus')).toThrow(/CarGurus/);
  });

  it('every adapter routes through the guard — none maps raw', () => {
    // The structural claim: a channel added next year gets the guard whether
    // or not whoever adds it has read this file. Asserted on the DESCRIPTION,
    // which every adapter carries — see the test below for why the headline
    // is the wrong field to make this claim with.
    for (const channel of ALL_CHANNELS) {
      expect(
        () => adapterFor(channel).map(vehicle({ description: 'Only £199 per month' })),
        `${channel} bypassed the guard`,
      ).toThrow(/CONC 3\.5\.3R/);
    }
  });

  it('a field a channel never receives cannot breach on that channel', () => {
    // CarGurus has no headline field, so an APR typed into the headline is
    // simply not sent there and there is nothing to refuse. Worth stating: the
    // guard protects the PAYLOAD, not the vehicle record, and that is the
    // correct boundary — the breach is what a portal renders, not what we
    // store. Auto Trader, which does carry it, still refuses.
    const withDodgyHeadline = vehicle({ headline: 'Representative APR 9.9%' });

    expect(() => autoTraderAdapter.map(withDodgyHeadline)).toThrow(/cost-of-credit/);

    const cargurus = carGurusAdapter.map(withDodgyHeadline);
    expect(Object.values(cargurus).join(' ')).not.toMatch(/APR/i);
  });
});

// ================================================== publishability

describe('what may be advertised at all', () => {
  it('a complete live car passes', () => {
    expect(canPublish(vehicle())).toBe(true);
  });

  it('refuses a car that is not live', () => {
    // The go-live gate applies to feeds too — it would be absurd to hold our
    // own shopfront to a higher standard than the portal a dealer pays for.
    const blockers = publishBlockers(vehicle({ state: 'in_prep' }));
    expect(blockers.map((b) => b.code)).toContain('not_live');
  });

  it('allows a reserved car to stay advertised', () => {
    expect(canPublish(vehicle({ state: 'reserved' }))).toBe(true);
  });

  it('refuses a car with no price', () => {
    expect(publishBlockers(vehicle({ price: null })).map((b) => b.code)).toContain('no_price');
    expect(publishBlockers(vehicle({ price: money(0n) })).map((b) => b.code)).toContain('no_price');
  });

  it('refuses a car with no photographs', () => {
    expect(publishBlockers(vehicle({ publishedPhotoCount: 0 })).map((b) => b.code))
      .toContain('no_photos');
  });

  it('refuses a car with no provenance check', () => {
    expect(publishBlockers(vehicle({ provenanceCheckedAt: null })).map((b) => b.code))
      .toContain('no_provenance');
  });

  it('applies the channel rule on top', () => {
    const blockers = publishBlockers(vehicle({ publishedPhotoCount: 4 }), { minPhotos: 8 });
    const blocker = blockers.find((b) => b.code === 'below_photo_rule');
    expect(blocker?.message).toMatch(/4 of 8/);
  });

  it('applies a price band', () => {
    expect(publishBlockers(vehicle(), { minPrice: money(2_500_000n) }).map((b) => b.code))
      .toContain('below_price_rule');
    expect(publishBlockers(vehicle(), { maxPrice: money(1_000_000n) }).map((b) => b.code))
      .toContain('above_price_rule');
  });

  it('applies make inclusion and exclusion, case-insensitively', () => {
    expect(canPublish(vehicle(), { makes: ['bmw', 'Audi'] })).toBe(true);
    expect(publishBlockers(vehicle(), { makes: ['Audi'] }).map((b) => b.code))
      .toContain('make_not_included');
    expect(publishBlockers(vehicle(), { excludeMakes: ['BMW'] }).map((b) => b.code))
      .toContain('make_excluded');
  });

  it('an override price is the price the rules are applied to', () => {
    // §8.3: an advertised price must be one the dealer will honour, so a
    // per-channel price is a REAL price and the band applies to it.
    expect(publishBlockers(vehicle(), { maxPrice: money(1_500_000n) },
      { price: money(1_400_000n) })).toHaveLength(0);
  });

  it('every blocker explains itself in more than a code', () => {
    for (const blocker of publishBlockers(vehicle({
      state: 'in_prep', price: null, publishedPhotoCount: 0, provenanceCheckedAt: null,
    }))) {
      expect(blocker.message.length).toBeGreaterThan(25);
    }
  });
});

// ====================================================== delisting

describe('delisting a sold car', () => {
  it('is required immediately by default', () => {
    const decision = delistDecision({
      trigger: 'sold', triggeredAt: D(3), delayMinutes: 0,
      status: 'published', asAt: D(3, 13),
    });
    expect(decision.required).toBe(true);
    expect(decision.overdue).toBe(true);
  });

  it('honours a configured delay', () => {
    // Some dealers keep a sold car up for a day to catch "similar vehicle"
    // enquiries. Both behaviours are supported.
    const decision = delistDecision({
      trigger: 'sold', triggeredAt: D(3), delayMinutes: 24 * 60,
      status: 'published', asAt: D(3, 18),
    });
    expect(decision.required).toBe(true);
    expect(decision.overdue).toBe(false);
    expect(decision.dueAt).toEqual(D(4));
  });

  it('becomes overdue once the deadline passes', () => {
    const decision = delistDecision({
      trigger: 'sold', triggeredAt: D(3), delayMinutes: 60,
      status: 'published', asAt: D(4),
    });
    expect(decision.overdue).toBe(true);
    expect(decision.reason).toMatch(/enquiries for it cannot be fulfilled/);
  });

  it('does NOT delist a merely reserved car by default', () => {
    // A reservation falls through often enough that pulling the advert costs
    // the dealer the next buyer.
    const decision = delistDecision({
      trigger: 'reserved', triggeredAt: D(3), delayMinutes: 0,
      status: 'published', asAt: D(4),
    });
    expect(decision.required).toBe(false);
    expect(decision.reason).toMatch(/falls through/);
  });

  it('delists a reserved car when the dealer has asked for that', () => {
    expect(delistDecision({
      trigger: 'reserved', triggeredAt: D(3), delayMinutes: 0,
      status: 'published', asAt: D(4), delistOnReserve: true,
    }).required).toBe(true);
  });

  it('has nothing to do for a car that was never published', () => {
    expect(delistDecision({
      trigger: 'sold', triggeredAt: D(3), delayMinutes: 0,
      status: 'not_published', asAt: D(4),
    }).required).toBe(false);
  });

  it('has nothing to do when nothing triggered it', () => {
    expect(delistDecision({
      trigger: null, triggeredAt: null, delayMinutes: 0,
      status: 'published', asAt: D(4),
    }).required).toBe(false);
  });
});

// =================================================== payload hash

describe('payload hashing', () => {
  it('is stable for the same payload', () => {
    const a = autoTraderAdapter.map(vehicle());
    const b = autoTraderAdapter.map(vehicle());
    expect(payloadHash(a)).toBe(payloadHash(b));
  });

  it('ignores property order', () => {
    // JSON.stringify follows insertion order — the same trap M12's canonical
    // JSON exists to avoid.
    expect(payloadHash({ a: '1', b: '2' })).toBe(payloadHash({ b: '2', a: '1' }));
  });

  it('changes when anything changes', () => {
    const before = autoTraderAdapter.map(vehicle());
    const after = autoTraderAdapter.map(vehicle({ price: money(1_899_900n) }));
    expect(payloadHash(before)).not.toBe(payloadHash(after));
  });

  it('does not re-push an unchanged car', () => {
    // Without this a nightly rebuild re-pushes every unchanged car to every
    // channel every night, exhausting the dealer's rate limit with their own
    // stock.
    const payload = autoTraderAdapter.map(vehicle());
    expect(shouldRepublish(payloadHash(payload), payload)).toBe(false);
    expect(shouldRepublish(null, payload)).toBe(true);
    expect(shouldRepublish('deadbeef', payload)).toBe(true);
  });

  it('the idempotency key names the channel, the car, the action and the payload', () => {
    const key = feedIdempotencyKey({
      channel: 'auto_trader', vehicleId: 'veh-1', action: 'publish', payloadHash: 'abc123',
    });
    expect(key).toBe('auto_trader:publish:veh-1:abc123');
  });

  it('property: a hash is always eight hex characters', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.string()),
      (payload) => {
        expect(payloadHash(payload as ChannelPayload)).toMatch(/^[0-9a-f]{8}$/);
      },
    ));
  });
});

// ======================================================= adapters

describe('the channel adapters', () => {
  it('every channel has one, and it is versioned', () => {
    for (const channel of ALL_CHANNELS) {
      const impl = adapterFor(channel);
      expect(impl.channel).toBe(channel);
      expect(impl.version).toBeGreaterThan(0);
    }
  });

  it('Auto Trader gets a whole-number mileage', () => {
    const payload = autoTraderAdapter.map(vehicle({ mileage: 42_500 }));
    expect(payload['odometerReadingMiles']).toBe(42_500);
    expect(Number.isInteger(payload['odometerReadingMiles'])).toBe(true);
  });

  it('Auto Trader rejects a fractional mileage with the message CLAUDE.md quotes', () => {
    const problems = autoTraderAdapter.validate({
      registration: 'WN22HNL', make: 'BMW', model: '3 Series', derivative: '320i',
      priceGBP: 19_999, odometerReadingMiles: 42_500.5,
    });
    const problem = problems.find((p) => p.field === 'odometerReadingMiles');
    expect(problem?.blocking).toBe(true);
    expect(problem?.message).toMatch(/whole number.*Fix the mileage and retry/);
  });

  it('Auto Trader warns about a thin photo set without blocking it', () => {
    const problems = autoTraderAdapter.validate(
      autoTraderAdapter.map(vehicle({ photoUrls: ['a.jpg', 'b.jpg'] })));
    const warning = problems.find((p) => p.field === 'images');
    expect(warning?.blocking).toBe(false);
  });

  it('CarGurus blocks a car with no VIN, because it matches on VIN', () => {
    const problems = carGurusAdapter.validate(carGurusAdapter.map(vehicle({ vin: null })));
    const problem = problems.find((p) => p.field === 'vin');
    expect(problem?.blocking).toBe(true);
    expect(problem?.message).toMatch(/merged with a different vehicle/);
  });

  it('Meta gets its enum values produced, never passed through', () => {
    const payload = metaCatalogueAdapter.map(vehicle());
    expect(payload['availability']).toBe('in stock');
    expect(payload['condition']).toBe('used');
    expect(payload['price']).toBe('19999.00 GBP');
  });

  it('Meta builds a title from year, make, model and derivative', () => {
    expect(metaCatalogueAdapter.map(vehicle())['title'])
      .toBe('2022 BMW 3 Series 320i M Sport 4dr Step Auto');
  });

  it('an override replaces the price, headline, description and photos', () => {
    const payload = autoTraderAdapter.map(vehicle(), {
      price: money(1_849_900n),
      headline: 'Channel-specific strapline',
      description: 'Channel-specific copy.',
      photoUrls: ['https://cdn.test/only.jpg'],
    });
    expect(payload['priceGBP']).toBe(18_499);
    expect(payload['attentionGrabber']).toBe('Channel-specific strapline');
    expect(payload['images']).toEqual(['https://cdn.test/only.jpg']);
  });

  it('missing required fields are reported per channel, not generically', () => {
    const bare = vehicle({ make: null, model: null, price: null });
    for (const channel of ALL_CHANNELS) {
      const impl = adapterFor(channel);
      const problems = impl.validate(impl.map(bare));
      expect(problems.some((p) => p.blocking), `${channel} accepted a car with no price`)
        .toBe(true);
    }
  });

  it('property: no adapter ever emits a finance signal from clean input', () => {
    fc.assert(fc.property(
      fc.record({
        make: fc.constantFrom('BMW', 'Audi', 'Ford'),
        mileage: fc.integer({ min: 0, max: 250_000 }),
        pricePence: fc.bigInt({ min: 100_000n, max: 10_000_000n }),
      }),
      ({ make, mileage, pricePence }) => {
        const v = vehicle({ make, mileage, price: money(pricePence) });
        for (const channel of ALL_CHANNELS) {
          expect(() => adapterFor(channel).map(v)).not.toThrow();
        }
      },
    ));
  });
});

// ================================================= publish preview

describe('the publish preview', () => {
  it('shows exactly what a channel will receive', () => {
    const preview = previewFor({ vehicle: vehicle(), channel: 'auto_trader' });
    expect(preview.ready).toBe(true);
    expect(preview.payload?.['registration']).toBe('WN22HNL');
    expect(preview.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(preview.channelLabel).toBe('Auto Trader');
  });

  it('REPORTS a compliance refusal rather than throwing', () => {
    // The one place a refusal is information rather than a failure: a dealer
    // needs to SEE why their description cannot be sent.
    const preview = previewFor({
      vehicle: vehicle({ description: 'Only £199 per month' }),
      channel: 'auto_trader',
    });
    expect(preview.ready).toBe(false);
    expect(preview.payload).toBeNull();
    expect(preview.refused).toMatch(/CONC 3\.5\.3R/);
  });

  it('is not ready while a blocking field is missing', () => {
    const preview = previewFor({ vehicle: vehicle({ vin: null }), channel: 'cargurus' });
    expect(preview.ready).toBe(false);
    expect(preview.problems.some((p) => p.blocking)).toBe(true);
  });

  it('IS ready when the only problems are warnings', () => {
    const preview = previewFor({
      vehicle: vehicle({ photoUrls: ['a.jpg'], publishedPhotoCount: 1 }),
      channel: 'auto_trader',
    });
    expect(preview.problems.some((p) => !p.blocking)).toBe(true);
    expect(preview.ready).toBe(true);
  });

  it('surfaces the go-live blockers alongside the field problems', () => {
    const preview = previewFor({
      vehicle: vehicle({ state: 'in_prep' }), channel: 'auto_trader',
    });
    expect(preview.blockers.map((b) => b.code)).toContain('not_live');
    expect(preview.ready).toBe(false);
  });
});

// ==================================================== feed health

describe('feed health', () => {
  const listing = (over: Partial<ListingState> = {}): ListingState => ({
    channel: 'auto_trader', vehicleId: 'v1', status: 'published',
    lastPublishedAt: D(4), lastAttemptAt: D(4), lastError: null,
    errorCount: 0, delistDueAt: null, ...over,
  });

  it('counts what is live, failing and queued', () => {
    const health = channelHealth({
      channel: 'auto_trader',
      listings: [
        listing({ vehicleId: 'a' }),
        listing({ vehicleId: 'b' }),
        listing({ vehicleId: 'c', status: 'failed', lastError: 'Invalid mileage' }),
        listing({ vehicleId: 'd', status: 'queued' }),
      ],
      asAt: D(4, 18),
    });
    expect(health.published).toBe(2);
    expect(health.failed).toBe(1);
    expect(health.queued).toBe(1);
    expect(health.stalled).toBe(false);
  });

  it('ignores other channels’ listings', () => {
    const health = channelHealth({
      channel: 'auto_trader',
      listings: [listing(), listing({ channel: 'cargurus', vehicleId: 'x' })],
      asAt: D(4, 18),
    });
    expect(health.published).toBe(1);
  });

  it('THE failure that actually happens: a whole channel quietly stops', () => {
    // Nobody notices for three weeks that the forecourt is missing from a
    // portal, because nothing is on fire — there is simply an absence.
    const health = channelHealth({
      channel: 'auto_trader',
      listings: [
        listing({ vehicleId: 'a', status: 'failed', lastError: '401', lastPublishedAt: D(1) }),
        listing({ vehicleId: 'b', status: 'failed', lastError: '401', lastPublishedAt: D(1) }),
      ],
      asAt: D(9),
    });
    expect(health.stalled).toBe(true);
    expect(health.summary).toMatch(/has not accepted anything for \d+ hours/);
    expect(health.summary).toMatch(/Check the credentials/);
  });

  it('one failing car is NOT a stalled channel', () => {
    const health = channelHealth({
      channel: 'auto_trader',
      listings: [
        listing({ vehicleId: 'a' }),
        listing({ vehicleId: 'b', status: 'failed', lastError: 'Invalid mileage',
          lastPublishedAt: null }),
      ],
      asAt: D(4, 18),
    });
    expect(health.stalled).toBe(false);
    expect(health.summary).toMatch(/The rest of the feed is working/);
  });

  it('counts sold cars still advertised past their deadline', () => {
    const health = channelHealth({
      channel: 'auto_trader',
      listings: [
        listing({ vehicleId: 'a' }),
        listing({ vehicleId: 'b', delistDueAt: D(3) }),
        listing({ vehicleId: 'c', delistDueAt: D(3), status: 'delist_queued' }),
      ],
      asAt: D(5),
    });
    expect(health.overdueDelistings).toBe(2);
    expect(health.summary).toMatch(/still advertised past the takedown deadline/);
  });

  it('an already-delisted car is not overdue', () => {
    const health = channelHealth({
      channel: 'auto_trader',
      listings: [listing({ status: 'delisted', delistDueAt: D(3) })],
      asAt: D(5),
    });
    expect(health.overdueDelistings).toBe(0);
  });
});

// ========================================================= retries

describe('retrying a failure', () => {
  it('NEVER auto-retries a rejected payload', () => {
    // The portal has told us the mileage is invalid. Sending identical bytes
    // gets an identical answer while burning the dealer's rate limit.
    expect(retryAfter({ outcome: 'rejected', errorCount: 1, lastAttemptAt: D(4) })).toBeNull();
    expect(describeRetry({ outcome: 'rejected', errorCount: 1, lastAttemptAt: D(4) }))
      .toMatch(/same answer/);
  });

  it('retries a transport error with exponential backoff', () => {
    const first = retryAfter({ outcome: 'transport_error', errorCount: 1, lastAttemptAt: D(4) })!;
    const third = retryAfter({ outcome: 'transport_error', errorCount: 3, lastAttemptAt: D(4) })!;
    expect(first.getTime() - D(4).getTime()).toBe(60_000);
    expect(third.getTime() - D(4).getTime()).toBe(4 * 60_000);
  });

  it('gives up after a stated number of attempts', () => {
    expect(retryAfter({
      outcome: 'transport_error', errorCount: MAX_AUTO_RETRIES, lastAttemptAt: D(4),
    })).toBeNull();
    expect(describeRetry({
      outcome: 'transport_error', errorCount: MAX_AUTO_RETRIES, lastAttemptAt: D(4),
    })).toMatch(/Given up after 5 attempts/);
  });
});

// =========================================================== fees

describe('mandatory fees', () => {
  it('sums to zero when there are none', () => {
    expect(totalMandatoryFees(vehicle())).toEqual(money(0n));
  });

  it('sums what the buyer must pay on top', () => {
    // §8.3 — a mandatory charge must be included or clearly disclosed.
    expect(totalMandatoryFees(vehicle({
      mandatoryFees: [
        { label: 'Admin fee', amount: money(19_900n) },
        { label: 'Delivery', amount: money(9_900n) },
      ],
    }))).toEqual(money(29_800n));
  });
});

describe('channel labels', () => {
  it('every channel has a human name', () => {
    for (const channel of ALL_CHANNELS) {
      expect(CHANNEL_LABELS[channel].length).toBeGreaterThan(3);
    }
  });
});
