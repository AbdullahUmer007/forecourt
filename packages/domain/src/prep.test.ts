import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  mergeIntervals, clampInterval, intervalMs,
  stageDurations, stageSlaState, moveBlockers,
  suggestTasksFromAdvisories, requiresApproval, costPosition,
  prepMetrics, prepPerformance, MIN_CARDS_FOR_AVERAGE,
  DEFAULT_PREP_STAGES, describeBlockReason,
  type PrepBlock, type StageEvent, type PrepStage, type Interval,
} from './prep.js';
import { money } from './money.js';

/** Hours from a fixed origin, so every interval in this file reads as a clock. */
const H = (hours: number): Date => new Date(Date.UTC(2026, 7, 3, 0, 0, 0) + hours * 3_600_000);
const D = (days: number): Date => H(days * 24);

const block = (over: Partial<PrepBlock> = {}): PrepBlock => ({
  id: 'b1', reason: 'awaiting_parts', note: null,
  startedAt: H(0), endedAt: H(24), ...over,
});

const event = (over: Partial<StageEvent> = {}): StageEvent => ({
  id: 'e1', stageId: 'bodywork', enteredAt: H(0), exitedAt: H(48), ...over,
});

const stage = (over: Partial<PrepStage> = {}): PrepStage => ({
  id: 'bodywork', key: 'bodywork', name: 'Bodywork / SMART', position: 4,
  slaHours: 72, requiresMinPhotos: false, isFinal: false, ...over,
});

// -------------------------------------------------------- interval maths

describe('merging intervals', () => {
  it('leaves separate periods alone', () => {
    const merged = mergeIntervals([
      { start: H(0), end: H(2) },
      { start: H(5), end: H(7) },
    ]);
    expect(merged).toHaveLength(2);
    expect(intervalMs(merged) / 3_600_000).toBe(4);
  });

  it('MERGES overlapping periods into one', () => {
    // The whole module turns on this. A car waiting for a part and an approval
    // at the same time has sat for one day, not two.
    const merged = mergeIntervals([
      { start: H(0), end: H(10) },
      { start: H(4), end: H(14) },
    ]);
    expect(merged).toHaveLength(1);
    expect(intervalMs(merged) / 3_600_000).toBe(14);
  });

  it('merges periods that merely touch', () => {
    const merged = mergeIntervals([
      { start: H(0), end: H(5) },
      { start: H(5), end: H(9) },
    ]);
    expect(merged).toHaveLength(1);
    expect(intervalMs(merged) / 3_600_000).toBe(9);
  });

  it('swallows a period entirely inside another', () => {
    const merged = mergeIntervals([
      { start: H(0), end: H(20) },
      { start: H(5), end: H(9) },
    ]);
    expect(merged).toHaveLength(1);
    expect(intervalMs(merged) / 3_600_000).toBe(20);
  });

  it('does not care what order they arrive in', () => {
    const a = mergeIntervals([{ start: H(5), end: H(9) }, { start: H(0), end: H(6) }]);
    const b = mergeIntervals([{ start: H(0), end: H(6) }, { start: H(5), end: H(9) }]);
    expect(intervalMs(a)).toBe(intervalMs(b));
  });

  it('drops zero-length and inverted periods', () => {
    expect(mergeIntervals([{ start: H(3), end: H(3) }])).toEqual([]);
    expect(mergeIntervals([{ start: H(9), end: H(2) }])).toEqual([]);
  });

  it('property: merged total never exceeds the naive sum', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 })),
        { maxLength: 25 }),
      (pairs) => {
        const intervals: Interval[] = pairs.map(([a, b]) => ({
          start: H(Math.min(a, b)), end: H(Math.max(a, b)),
        }));
        const naive = intervals.reduce(
          (t, i) => t + (i.end.getTime() - i.start.getTime()), 0);
        expect(intervalMs(mergeIntervals(intervals))).toBeLessThanOrEqual(naive);
      },
    ));
  });

  it('property: merged total never exceeds the span it covers', () => {
    // The property that stops a report claiming more blocked time than the car
    // has been in stock.
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 500 })),
        { minLength: 1, maxLength: 25 }),
      (pairs) => {
        const intervals: Interval[] = pairs.map(([a, b]) => ({
          start: H(Math.min(a, b)), end: H(Math.max(a, b)),
        }));
        const lo = Math.min(...intervals.map((i) => i.start.getTime()));
        const hi = Math.max(...intervals.map((i) => i.end.getTime()));
        expect(intervalMs(mergeIntervals(intervals))).toBeLessThanOrEqual(hi - lo);
      },
    ));
  });

  it('property: merging twice changes nothing', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 })),
        { maxLength: 15 }),
      (pairs) => {
        const intervals: Interval[] = pairs.map(([a, b]) => ({
          start: H(Math.min(a, b)), end: H(Math.max(a, b)),
        }));
        const once = mergeIntervals(intervals);
        expect(intervalMs(mergeIntervals(once))).toBe(intervalMs(once));
      },
    ));
  });
});

describe('clamping an interval to a window', () => {
  it('keeps only the overlapping part', () => {
    const clamped = clampInterval({ start: H(0), end: H(20) }, { start: H(5), end: H(12) })!;
    expect(clamped.start).toEqual(H(5));
    expect(clamped.end).toEqual(H(12));
  });

  it('returns null when they do not overlap', () => {
    expect(clampInterval({ start: H(0), end: H(2) }, { start: H(5), end: H(9) })).toBeNull();
  });

  it('returns null when they only touch', () => {
    expect(clampInterval({ start: H(0), end: H(5) }, { start: H(5), end: H(9) })).toBeNull();
  });
});

// ------------------------------------------------------ stage durations

describe('stage durations', () => {
  it('splits elapsed time into working and blocked', () => {
    // 48 hours in Bodywork, 24 of them waiting for a part.
    const [duration] = stageDurations([event()], [block()], H(48));
    expect(duration!.elapsedHours).toBe(48);
    expect(duration!.blockedHours).toBe(24);
    expect(duration!.workingHours).toBe(24);
  });

  it('counts two SIMULTANEOUS causes as one blocked period', () => {
    // The number that decides whether anyone trusts this board.
    const [duration] = stageDurations(
      [event()],
      [
        block({ id: 'b1', reason: 'awaiting_parts', startedAt: H(0), endedAt: H(24) }),
        block({ id: 'b2', reason: 'awaiting_approval', startedAt: H(6), endedAt: H(18) }),
      ],
      H(48),
    );
    expect(duration!.blockedHours).toBe(24);
    expect(duration!.workingHours).toBe(24);
  });

  it('still names BOTH causes, even though the day is counted once', () => {
    // A dealer asking "what is costing me days?" needs to see that approvals
    // contributed too. The per-reason hours may therefore sum to more than
    // blockedHours, which is correct and deliberate.
    const [duration] = stageDurations(
      [event()],
      [
        block({ id: 'b1', reason: 'awaiting_parts', startedAt: H(0), endedAt: H(24) }),
        block({ id: 'b2', reason: 'awaiting_approval', startedAt: H(6), endedAt: H(18) }),
      ],
      H(48),
    );
    expect(duration!.blockedBy.map((b) => b.reason)).toEqual(
      ['awaiting_parts', 'awaiting_approval']);
    expect(duration!.blockedBy[0]!.hours).toBe(24);
    expect(duration!.blockedBy[1]!.hours).toBe(12);
  });

  it('clips a block that started before the stage did', () => {
    // A part ordered in Mechanical that arrives during Bodywork belongs partly
    // to each stage, not wholly to whichever one you happen to be looking at.
    const [duration] = stageDurations(
      [event({ enteredAt: H(10), exitedAt: H(30) })],
      [block({ startedAt: H(0), endedAt: H(20) })],
      H(30),
    );
    expect(duration!.elapsedHours).toBe(20);
    expect(duration!.blockedHours).toBe(10);
  });

  it('ignores a block entirely outside the stage', () => {
    const [duration] = stageDurations(
      [event({ enteredAt: H(10), exitedAt: H(20) })],
      [block({ startedAt: H(30), endedAt: H(40) })],
      H(40),
    );
    expect(duration!.blockedHours).toBe(0);
  });

  it('measures an open stage up to now', () => {
    const [duration] = stageDurations([event({ exitedAt: null })], [], H(12));
    expect(duration!.elapsedHours).toBe(12);
    expect(duration!.open).toBe(true);
  });

  it('measures an open block up to now', () => {
    const [duration] = stageDurations(
      [event({ exitedAt: null })], [block({ startedAt: H(4), endedAt: null })], H(12));
    expect(duration!.blockedHours).toBe(8);
  });

  it('property: working + blocked always equals elapsed, and none is negative', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 400 }),
      fc.array(fc.tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 })),
        { maxLength: 12 }),
      (stageHours, pairs) => {
        const blocks = pairs.map(([a, b], i) => block({
          id: `b${i}`,
          startedAt: H(Math.min(a, b)),
          endedAt: H(Math.max(a, b)),
        }));
        const [duration] = stageDurations(
          [event({ enteredAt: H(0), exitedAt: H(stageHours) })], blocks, H(stageHours));

        expect(duration!.blockedHours).toBeGreaterThanOrEqual(0);
        expect(duration!.workingHours).toBeGreaterThanOrEqual(0);
        expect(duration!.blockedHours).toBeLessThanOrEqual(duration!.elapsedHours);
        expect(duration!.workingHours + duration!.blockedHours)
          .toBeCloseTo(duration!.elapsedHours, 1);
      },
    ));
  });
});

// ---------------------------------------------------------------- SLA

describe('SLA', () => {
  it('measures against WORKING time, not wall-clock', () => {
    // A stage that overran because a supplier had the part on back-order is
    // not the workshop's failure, and flagging it as one teaches everyone to
    // ignore the flag.
    const [duration] = stageDurations(
      [event({ enteredAt: H(0), exitedAt: H(96) })],
      [block({ startedAt: H(0), endedAt: H(60) })],
      H(96),
    );
    const sla = stageSlaState(duration!, stage({ slaHours: 48 }));
    expect(duration!.elapsedHours).toBe(96);   // four days on the board
    expect(duration!.workingHours).toBe(36);   // a day and a half of work
    expect(sla.breached).toBe(false);
  });

  it('breaches when the WORK itself overran', () => {
    const [duration] = stageDurations(
      [event({ enteredAt: H(0), exitedAt: H(96) })], [], H(96));
    const sla = stageSlaState(duration!, stage({ slaHours: 48 }));
    expect(sla.breached).toBe(true);
    expect(sla.hoursOver).toBe(48);
  });

  it('a stage with no target never breaches', () => {
    const [duration] = stageDurations(
      [event({ enteredAt: H(0), exitedAt: H(500) })], [], H(500));
    expect(stageSlaState(duration!, stage({ slaHours: null })).breached).toBe(false);
  });

  it('the summary reports the waiting time even when it is not counted', () => {
    const [duration] = stageDurations(
      [event({ enteredAt: H(0), exitedAt: H(96) })],
      [block({ startedAt: H(0), endedAt: H(60) })],
      H(96),
    );
    expect(stageSlaState(duration!, stage({ slaHours: 48 })).summary).toMatch(/60h waiting/);
  });
});

// ----------------------------------------------------------- moving on

describe('moving a card between stages', () => {
  const base = {
    from: stage({ key: 'photography', requiresMinPhotos: true }),
    to: stage({ id: 'qc', key: 'quality_check', requiresMinPhotos: false }),
    publishedPhotoCount: 12,
    minimumPhotos: 8,
    openTasks: [],
    openBlocks: [],
  };

  it('a complete card moves freely', () => {
    expect(moveBlockers(base)).toHaveLength(0);
  });

  it('THE photography gate: cannot leave Photography without the minimum set', () => {
    const blockers = moveBlockers({ ...base, publishedPhotoCount: 3 });
    const gate = blockers.find((b) => b.code === 'insufficient_photos');
    expect(gate?.overridable).toBe(false);
    expect(gate?.message).toMatch(/3 of 8/);
  });

  it('the gate only applies to the stage that declares it', () => {
    expect(moveBlockers({
      ...base,
      from: stage({ key: 'valet', requiresMinPhotos: false }),
      publishedPhotoCount: 0,
    })).toHaveLength(0);
  });

  it('unapproved work over the threshold cannot be moved past, at all', () => {
    const blockers = moveBlockers({
      ...base,
      openTasks: [{
        status: 'in_progress', description: 'Front bumper respray',
        approvalRequired: true, approvedAt: null,
      }],
    });
    expect(blockers.find((b) => b.code === 'unapproved_task')?.overridable).toBe(false);
  });

  it('approved work does not block', () => {
    expect(moveBlockers({
      ...base,
      openTasks: [{
        status: 'in_progress', description: 'Front bumper respray',
        approvalRequired: true, approvedAt: H(1),
      }],
    })).toHaveLength(0);
  });

  it('unfinished work blocks reaching the FINAL stage, overridably', () => {
    const blockers = moveBlockers({
      ...base,
      to: stage({ id: 'ready', key: 'ready', isFinal: true }),
      openTasks: [{
        status: 'planned', description: 'Replace nearside wiper',
        approvalRequired: false, approvedAt: null,
      }],
    });
    const blocker = blockers.find((b) => b.code === 'unfinished_task');
    expect(blocker?.overridable).toBe(true);
    expect(blocker?.message).toMatch(/still planned/);
  });

  it('unfinished work does not block a mid-pipeline move', () => {
    expect(moveBlockers({
      ...base,
      openTasks: [{
        status: 'planned', description: 'Replace nearside wiper',
        approvalRequired: false, approvedAt: null,
      }],
    })).toHaveLength(0);
  });

  it('an open block is overridable and says what it is waiting for', () => {
    const blockers = moveBlockers({
      ...base,
      openBlocks: [block({ reason: 'awaiting_parts', note: 'NSF wing, ETA Thursday', endedAt: null })],
    });
    const blocker = blockers.find((b) => b.code === 'open_block');
    expect(blocker?.overridable).toBe(true);
    expect(blocker?.message).toMatch(/NSF wing/);
  });
});

// ---------------------------------------------- MOT advisories → tasks

describe('MOT advisories become suggested work', () => {
  it('turns each advisory into a task', () => {
    const tasks = suggestTasksFromAdvisories([
      'Nearside front tyre worn close to the legal limit',
      'Offside rear shock absorber has a slight misting of oil',
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.source).toBe('mot_advisory');
  });

  it('categorises the obvious ones', () => {
    expect(suggestTasksFromAdvisories(['Nearside front tyre worn close to the legal limit'])[0]!
      .category).toBe('tyres');
    expect(suggestTasksFromAdvisories(['Brake disc worn, pitted or scored'])[0]!
      .category).toBe('mechanical');
    expect(suggestTasksFromAdvisories(['Corrosion to the nearside sill'])[0]!
      .category).toBe('bodywork');
  });

  it('files an unrecognised advisory as "other" rather than GUESSING', () => {
    // A tyre job filed under bodywork is worse than one filed as "not sure",
    // because it silently skews the cost analysis this module produces.
    expect(suggestTasksFromAdvisories(['Something the tester phrased unusually'])[0]!
      .category).toBe('other');
  });

  it('deduplicates the same advisory repeated across axles or tests', () => {
    const tasks = suggestTasksFromAdvisories([
      'Tyre worn close to the legal limit',
      'tyre worn close to the legal limit',
      '  Tyre worn close to the legal limit  ',
    ]);
    expect(tasks).toHaveLength(1);
  });

  it('keeps the tester’s exact wording, so it is clearly not ours', () => {
    const text = 'Nearside front tyre worn close to the legal limit';
    expect(suggestTasksFromAdvisories([text])[0]!.sourceDetail).toBe(text);
  });

  it('ignores blank entries', () => {
    expect(suggestTasksFromAdvisories(['', '   '])).toHaveLength(0);
  });
});

// ------------------------------------------------------------ approvals

describe('the approval threshold', () => {
  it('catches work at or above the threshold', () => {
    // `>=`, because a £500 threshold that lets a £500 job through is a
    // threshold nobody can explain.
    expect(requiresApproval(money(50_000n), money(50_000n))).toBe(true);
    expect(requiresApproval(money(50_001n), money(50_000n))).toBe(true);
    expect(requiresApproval(money(49_999n), money(50_000n))).toBe(false);
  });
});

// --------------------------------------------------------- the budget

describe('spend against budget', () => {
  it('reports under budget', () => {
    const position = costPosition(money(60_000n), [money(20_000n), money(25_000n)]);
    expect(position.overBudget).toBe(false);
    expect(position.variance).toEqual(money(-15_000n));
  });

  it('reports over budget', () => {
    const position = costPosition(money(40_000n), [money(55_000n)]);
    expect(position.overBudget).toBe(true);
    expect(position.variance).toEqual(money(15_000n));
  });

  it('exactly on budget is not over budget', () => {
    expect(costPosition(money(40_000n), [money(40_000n)]).overBudget).toBe(false);
  });

  it('an unbudgeted card says so, rather than reporting 100% over', () => {
    // Treating a missing budget as zero makes every car in the first month
    // look like a disaster, and a report that cries wolf in week one is one
    // nobody opens in week four.
    const position = costPosition(null, [money(55_000n)]);
    expect(position.unbudgeted).toBe(true);
    expect(position.overBudget).toBe(false);
    expect(position.summary).toMatch(/nothing to compare/);
  });
});

// ----------------------------------------------------------- metrics

describe('card metrics', () => {
  it('reports days in prep only once the card is finished', () => {
    // An average that quietly includes in-flight cars is biased downwards by
    // every car still sitting on the board — the wrong direction entirely.
    expect(prepMetrics({ startedAt: D(0), completedAt: null }, [], D(5)).daysInPrep).toBeNull();
    expect(prepMetrics({ startedAt: D(0), completedAt: D(5) }, [], D(5)).daysInPrep).toBe(5);
  });

  it('splits the days into working and blocked', () => {
    const metrics = prepMetrics(
      { startedAt: D(0), completedAt: D(10) },
      [block({ startedAt: D(2), endedAt: D(6) })],
      D(10),
    );
    expect(metrics.blockedDays).toBe(4);
    expect(metrics.workingDays).toBe(6);
  });

  it('names the single worst cause', () => {
    const metrics = prepMetrics(
      { startedAt: D(0), completedAt: D(10) },
      [
        block({ id: 'b1', reason: 'awaiting_approval', startedAt: D(1), endedAt: D(2) }),
        block({ id: 'b2', reason: 'awaiting_parts', startedAt: D(3), endedAt: D(8) }),
      ],
      D(10),
    );
    expect(metrics.worstCause?.reason).toBe('awaiting_parts');
  });
});

describe('the weekly performance report', () => {
  const card = (days: number, blocked: number) => ({
    startedAt: D(0),
    completedAt: D(days),
    events: [event({ enteredAt: D(0), exitedAt: D(days) })],
    blocks: blocked > 0 ? [block({ startedAt: D(0), endedAt: D(blocked) })] : [],
  });

  it('refuses to report an average from too few cars', () => {
    // Same rule as M13's observed recon averages and M8's representative APR
    // report: somebody changes how they run their workshop on the strength of
    // a number built from three cars.
    const report = prepPerformance({ cards: [card(5, 1), card(7, 2)], asAt: D(30) });
    expect(report.insufficientData).toBe(true);
    expect(report.averageDaysInPrep).toBeNull();
    expect(report.completedCards).toBe(2);
  });

  it('reports the average once there is enough evidence', () => {
    const cards = Array.from({ length: MIN_CARDS_FOR_AVERAGE }, () => card(6, 2));
    const report = prepPerformance({ cards, asAt: D(30) });
    expect(report.insufficientData).toBe(false);
    expect(report.averageDaysInPrep).toBe(6);
  });

  it('ignores cards still on the board', () => {
    const open = { startedAt: D(0), completedAt: null, events: [], blocks: [] };
    const report = prepPerformance({ cards: [card(5, 1), open], asAt: D(30) });
    expect(report.completedCards).toBe(1);
  });

  it('ranks blocked days by cause, worst first', () => {
    const report = prepPerformance({
      cards: [{
        startedAt: D(0), completedAt: D(10),
        events: [event({ enteredAt: D(0), exitedAt: D(10) })],
        blocks: [
          block({ id: 'b1', reason: 'awaiting_approval', startedAt: D(0), endedAt: D(1) }),
          block({ id: 'b2', reason: 'awaiting_parts', startedAt: D(2), endedAt: D(8) }),
        ],
      }],
      asAt: D(10),
    });
    expect(report.blockedDaysByCause[0]).toEqual({ reason: 'awaiting_parts', days: 6 });
  });
});

// -------------------------------------------------------------- stages

describe('the default board', () => {
  it('runs from awaiting collection to ready', () => {
    expect(DEFAULT_PREP_STAGES[0]!.key).toBe('awaiting_collection');
    expect(DEFAULT_PREP_STAGES.at(-1)!.key).toBe('ready');
  });

  it('has exactly one final stage', () => {
    expect(DEFAULT_PREP_STAGES.filter((s) => s.isFinal)).toHaveLength(1);
  });

  it('positions are unique and in order', () => {
    const positions = DEFAULT_PREP_STAGES.map((s) => s.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('exactly one stage carries the photography gate', () => {
    const gated = DEFAULT_PREP_STAGES.filter((s) => s.requiresMinPhotos);
    expect(gated).toHaveLength(1);
    expect(gated[0]!.key).toBe('photography');
  });

  it('every block reason has plain English', () => {
    for (const reason of [
      'awaiting_parts', 'awaiting_approval', 'awaiting_supplier_slot',
      'awaiting_mot_slot', 'awaiting_decision', 'awaiting_payment', 'other',
    ] as const) {
      expect(describeBlockReason(reason).length).toBeGreaterThan(6);
    }
  });
});
