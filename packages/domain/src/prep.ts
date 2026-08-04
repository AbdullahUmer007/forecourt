/**
 * M14 — the preparation pipeline.
 *
 * The functional spec calls this the module that proves ROI. The claim is
 * narrower than "we make prep faster", and the narrow version is the one that
 * survives contact with a dealer:
 *
 *   A car in prep is rarely slow because the work is slow. It is slow because
 *   the car SITS — waiting for a wing, a manager's approval, a bodyshop slot.
 *   "Eleven days in Bodywork" is a number a dealer can do nothing with.
 *   "Eleven days in Bodywork, nine of them waiting for a part" is an
 *   instruction.
 *
 * So the load-bearing function in this file is `stageDurations`, and the
 * load-bearing detail is that overlapping blocks are MERGED before counting.
 * A car waiting on a part and an approval simultaneously has sat for one day,
 * not two, and a report that says otherwise can exceed the time the car has
 * been in stock — at which point nobody believes any of the numbers again.
 */

import { type Money, money, subtract, sum, zero, isNegative } from './money.js';

// ------------------------------------------------------------------ types

export type PrepTaskStatus =
  | 'suggested' | 'planned' | 'approved' | 'in_progress' | 'blocked' | 'done' | 'declined';

export type PrepTaskSource = 'manual' | 'mot_advisory' | 'appraisal' | 'standard_plan';

export type PrepBlockReason =
  | 'awaiting_parts' | 'awaiting_approval' | 'awaiting_supplier_slot'
  | 'awaiting_mot_slot' | 'awaiting_decision' | 'awaiting_payment' | 'other';

export interface PrepStage {
  id: string;
  key: string;
  name: string;
  position: number;
  slaHours: number | null;
  requiresMinPhotos: boolean;
  isFinal: boolean;
}

export interface StageEvent {
  id: string;
  stageId: string;
  enteredAt: Date;
  exitedAt: Date | null;
}

export interface PrepBlock {
  id: string;
  reason: PrepBlockReason;
  note: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * The stages a dealer gets on day one.
 *
 * Seeded rather than hard-coded — a dealer with no bodyshop should be able to
 * delete Bodywork instead of staring at an empty column forever — but the
 * defaults are here so provisioning and the tests agree on them.
 */
export const DEFAULT_PREP_STAGES: readonly Omit<PrepStage, 'id'>[] = [
  { key: 'awaiting_collection', name: 'Awaiting collection', position: 1, slaHours: 72, requiresMinPhotos: false, isFinal: false },
  { key: 'booked_in', name: 'Booked in', position: 2, slaHours: 24, requiresMinPhotos: false, isFinal: false },
  { key: 'mechanical', name: 'Mechanical', position: 3, slaHours: 48, requiresMinPhotos: false, isFinal: false },
  { key: 'bodywork', name: 'Bodywork / SMART', position: 4, slaHours: 72, requiresMinPhotos: false, isFinal: false },
  { key: 'mot', name: 'MOT', position: 5, slaHours: 24, requiresMinPhotos: false, isFinal: false },
  { key: 'parts_on_order', name: 'Parts on order', position: 6, slaHours: null, requiresMinPhotos: false, isFinal: false },
  { key: 'valet', name: 'Valet', position: 7, slaHours: 24, requiresMinPhotos: false, isFinal: false },
  // The photography gate — §7.4. A vehicle cannot leave this stage without
  // the minimum published photo set.
  { key: 'photography', name: 'Photography', position: 8, slaHours: 24, requiresMinPhotos: true, isFinal: false },
  { key: 'quality_check', name: 'Quality check', position: 9, slaHours: 24, requiresMinPhotos: false, isFinal: false },
  { key: 'ready', name: 'Ready', position: 10, slaHours: null, requiresMinPhotos: false, isFinal: true },
];

// ------------------------------------------------------- interval maths

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface Interval {
  start: Date;
  end: Date;
}

/**
 * Merge overlapping and touching intervals into the smallest equivalent set.
 *
 * THE function this module turns on. Two blocks that overlap are one period of
 * a car sitting still, and counting them separately produces more blocked time
 * than has elapsed — a report that can say a car sat for 14 days in a 9-day
 * stage is a report nobody trusts again, including the parts of it that were
 * right.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start.getTime() <= last.end.getTime()) {
      // Overlapping or touching: extend, never append.
      if (current.end.getTime() > last.end.getTime()) last.end = current.end;
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}

/** The part of `inner` that falls inside `outer`. */
export const clampInterval = (inner: Interval, outer: Interval): Interval | null => {
  const start = Math.max(inner.start.getTime(), outer.start.getTime());
  const end = Math.min(inner.end.getTime(), outer.end.getTime());
  return end > start ? { start: new Date(start), end: new Date(end) } : null;
};

export const intervalMs = (intervals: readonly Interval[]): number =>
  intervals.reduce((total, i) => total + (i.end.getTime() - i.start.getTime()), 0);

/** An open period ends now, for the purpose of measuring it. */
const closeWith = (start: Date, end: Date | null, asAt: Date): Interval => ({
  start,
  end: end ?? asAt,
});

// ------------------------------------------------------ stage durations

export interface StageDuration {
  stageId: string;
  enteredAt: Date;
  exitedAt: Date | null;
  /** Wall-clock time in the stage. */
  elapsedHours: number;
  /** Of which the car was waiting on something. */
  blockedHours: number;
  /** elapsed − blocked. What the workshop actually had the car for. */
  workingHours: number;
  /** The causes that contributed, most costly first. */
  blockedBy: readonly { reason: PrepBlockReason; hours: number }[];
  open: boolean;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * How long a card spent in each stage, split into working and blocked time.
 *
 * Blocks are clamped to the stage window first — a block that spans a stage
 * boundary belongs partly to each — and then merged, so simultaneous causes
 * count once. The per-reason breakdown is deliberately NOT merged across
 * reasons: a dealer asking "what is costing me days?" wants to see that parts
 * and approvals each contributed, even though the day itself is counted once.
 * That means the reason hours can sum to MORE than `blockedHours`, which is
 * correct and is why they are reported separately rather than as a split.
 */
export function stageDurations(
  events: readonly StageEvent[],
  blocks: readonly PrepBlock[],
  asAt: Date,
): StageDuration[] {
  return [...events]
    .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime())
    .map((event) => {
      const window = closeWith(event.enteredAt, event.exitedAt, asAt);
      const elapsedMs = Math.max(0, window.end.getTime() - window.start.getTime());

      const overlapping = blocks
        .map((b) => clampInterval(closeWith(b.startedAt, b.endedAt, asAt), window))
        .filter((i): i is Interval => i !== null);

      const blockedMs = intervalMs(mergeIntervals(overlapping));

      const byReason = new Map<PrepBlockReason, number>();
      for (const block of blocks) {
        const slice = clampInterval(closeWith(block.startedAt, block.endedAt, asAt), window);
        if (!slice) continue;
        byReason.set(
          block.reason,
          (byReason.get(block.reason) ?? 0) + (slice.end.getTime() - slice.start.getTime()),
        );
      }

      return {
        stageId: event.stageId,
        enteredAt: event.enteredAt,
        exitedAt: event.exitedAt,
        elapsedHours: round1(elapsedMs / MS_PER_HOUR),
        blockedHours: round1(blockedMs / MS_PER_HOUR),
        // Never negative: blocked time is clamped to the stage window, so it
        // cannot exceed elapsed — but the max() is kept because a future edit
        // to the clamping is exactly the kind of change that would break it
        // silently.
        workingHours: round1(Math.max(0, elapsedMs - blockedMs) / MS_PER_HOUR),
        blockedBy: [...byReason.entries()]
          .map(([reason, ms]) => ({ reason, hours: round1(ms / MS_PER_HOUR) }))
          .sort((a, b) => b.hours - a.hours),
        open: event.exitedAt === null,
      };
    });
}

// ----------------------------------------------------------------- SLA

export interface StageSlaState {
  stageId: string;
  slaHours: number | null;
  elapsedHours: number;
  workingHours: number;
  breached: boolean;
  hoursOver: number;
  summary: string;
}

/**
 * SLA is measured against WORKING time, not wall-clock.
 *
 * A stage that breaches because a supplier had the part on back-order is not
 * the workshop's failure, and reporting it as one teaches everybody to ignore
 * the flag. The blocked time still shows — it is the other half of the weekly
 * report, and usually the actionable half — but it is not counted against the
 * person doing the work.
 */
export function stageSlaState(
  duration: StageDuration,
  stage: Pick<PrepStage, 'slaHours' | 'name'>,
): StageSlaState {
  const slaHours = stage.slaHours;
  if (slaHours === null) {
    return {
      stageId: duration.stageId, slaHours: null,
      elapsedHours: duration.elapsedHours, workingHours: duration.workingHours,
      breached: false, hoursOver: 0,
      summary: `${stage.name}: no target set.`,
    };
  }

  const hoursOver = round1(Math.max(0, duration.workingHours - slaHours));
  const breached = hoursOver > 0;

  return {
    stageId: duration.stageId,
    slaHours,
    elapsedHours: duration.elapsedHours,
    workingHours: duration.workingHours,
    breached,
    hoursOver,
    summary: breached
      ? `${stage.name}: ${duration.workingHours}h of work against a ${slaHours}h target — ` +
        `${hoursOver}h over` +
        (duration.blockedHours > 0
          ? `, and a further ${duration.blockedHours}h waiting.`
          : '.')
      : `${stage.name}: ${duration.workingHours}h of work against a ${slaHours}h target` +
        (duration.blockedHours > 0 ? `, plus ${duration.blockedHours}h waiting.` : '.'),
  };
}

// --------------------------------------------------------- moving a card

export interface MoveBlocker {
  code: string;
  message: string;
  overridable: boolean;
}

/**
 * What stands between a card and the next stage.
 *
 * Same shape as M3's go-live blockers and M13's conversion blockers: a list
 * with per-blocker `overridable` flags rather than a boolean, because the
 * person holding the phone needs to know exactly what to fix.
 */
export function moveBlockers(input: {
  from: PrepStage;
  to: PrepStage;
  publishedPhotoCount: number;
  minimumPhotos: number;
  openTasks: readonly { status: PrepTaskStatus; description: string; approvalRequired: boolean; approvedAt: Date | null }[];
  openBlocks: readonly PrepBlock[];
}): MoveBlocker[] {
  const blockers: MoveBlocker[] = [];

  // §7.4 — the photography gate. Enforced on LEAVING the stage that requires
  // photos, not on entering Ready, so the person who can fix it is the person
  // being stopped.
  if (input.from.requiresMinPhotos && input.publishedPhotoCount < input.minimumPhotos) {
    blockers.push({
      code: 'insufficient_photos',
      message:
        `${input.publishedPhotoCount} of ${input.minimumPhotos} photographs published. ` +
        'A car cannot go forward from Photography without the minimum set — it is what the ' +
        'advert is built from.',
      overridable: false,
    });
  }

  // Work that needed a manager's approval and never got it.
  const unapproved = input.openTasks.filter(
    (t) => t.approvalRequired && t.approvedAt === null && t.status !== 'declined',
  );
  for (const task of unapproved) {
    blockers.push({
      code: 'unapproved_task',
      message: `“${task.description}” is over the approval threshold and has not been approved.`,
      overridable: false,
    });
  }

  if (input.to.isFinal) {
    const unfinished = input.openTasks.filter(
      (t) => t.status !== 'done' && t.status !== 'declined',
    );
    for (const task of unfinished) {
      blockers.push({
        code: 'unfinished_task',
        message: `“${task.description}” is still ${task.status.replace(/_/g, ' ')}.`,
        // A dealer may legitimately decide the last job can wait — but it has
        // to be a decision someone made, not a card that quietly slid through.
        overridable: true,
      });
    }
  }

  for (const block of input.openBlocks) {
    blockers.push({
      code: 'open_block',
      message:
        `Still ${block.reason.replace(/_/g, ' ')}` +
        (block.note ? ` — ${block.note}` : '') +
        '. Close the block, or move it anyway and say why.',
      overridable: true,
    });
  }

  return blockers;
}

// ------------------------------------------------- MOT advisories → work

export interface SuggestedTask {
  description: string;
  category: string;
  source: PrepTaskSource;
  sourceDetail: string;
}

/**
 * Advisories from the last MOT, as suggested work items.
 *
 * §5.3 calls this "a small feature dealers love", and it costs nothing: M4
 * already parses the advisories, and a car arriving with "nearside front tyre
 * worn close to the legal limit" on its record is a car that needs a tyre.
 *
 * They are SUGGESTED, never planned: the dealer decides what to do, and a
 * pipeline that silently books work off a government API is one that spends
 * their money without asking.
 */
const ADVISORY_CATEGORY: readonly { pattern: RegExp; category: string }[] = [
  { pattern: /\btyre|tread|worn close to the legal limit\b/i, category: 'tyres' },
  { pattern: /\bbrake|disc|pad|handbrake\b/i, category: 'mechanical' },
  { pattern: /\bsuspension|shock|spring|bush|arm\b/i, category: 'mechanical' },
  { pattern: /\bexhaust|emission|catalyst\b/i, category: 'mechanical' },
  { pattern: /\bcorros|rust\b/i, category: 'bodywork' },
  { pattern: /\blamp|light|bulb|indicator|headlamp\b/i, category: 'parts' },
  { pattern: /\bwiper|washer|screen|glass|mirror\b/i, category: 'parts' },
  { pattern: /\bleak|oil|fluid\b/i, category: 'mechanical' },
];

export function suggestTasksFromAdvisories(
  advisories: readonly string[],
): SuggestedTask[] {
  const seen = new Set<string>();
  const tasks: SuggestedTask[] = [];

  for (const advisory of advisories) {
    const text = advisory.trim();
    if (!text) continue;

    // The same advisory is often recorded on several axles or repeated across
    // tests. One work item per distinct wording.
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);

    const matched = ADVISORY_CATEGORY.find((c) => c.pattern.test(text));
    tasks.push({
      description: text,
      // `other` rather than a guess. A tyre job filed under bodywork is worse
      // than one filed under "we are not sure", because it silently skews the
      // cost analysis this module exists to produce.
      category: matched?.category ?? 'other',
      source: 'mot_advisory',
      sourceDetail: text,
    });
  }

  return tasks;
}

// ------------------------------------------------------------- approvals

/**
 * Whether a line of work needs a manager before it can be committed.
 *
 * The threshold comes from tenant settings, not a constant — a dealer doing
 * 25 cars a month and one doing 200 do not have the same idea of what is
 * worth a signature. `>=` rather than `>` because a threshold of £500 that
 * lets a £500 job through is a threshold nobody can explain.
 */
export const requiresApproval = (estimate: Money, threshold: Money): boolean =>
  estimate.amount >= threshold.amount;

// ----------------------------------------------------------- the budget

export interface CostPosition {
  budget: Money | null;
  committed: Money;
  variance: Money | null;
  overBudget: boolean;
  /** True when there is no budget to compare against — not "on budget". */
  unbudgeted: boolean;
  summary: string;
}

/**
 * Spend against budget.
 *
 * An unbudgeted card reports `unbudgeted`, never "0% over". Treating a missing
 * budget as zero makes every car in the first month look like a disaster, and
 * a report that cries wolf in week one is a report nobody opens in week four.
 */
export function costPosition(budget: Money | null, committed: readonly Money[]): CostPosition {
  const currency = budget?.currency ?? committed[0]?.currency ?? 'GBP';
  const total = sum(committed, currency);

  if (budget === null) {
    return {
      budget: null, committed: total, variance: null, overBudget: false, unbudgeted: true,
      summary: 'No prep budget set for this car, so there is nothing to compare the spend against.',
    };
  }

  const variance = subtract(total, budget);
  return {
    budget, committed: total, variance,
    overBudget: !isNegative(variance) && variance.amount !== 0n,
    unbudgeted: false,
    summary: variance.amount === 0n
      ? 'Exactly on budget.'
      : isNegative(variance)
        ? `${money(-variance.amount, currency).amount / 100n} pounds under budget.`
        : `${money(variance.amount, currency).amount / 100n} pounds over budget.`,
  };
}

// ------------------------------------------------------ days-to-live

export interface PrepMetrics {
  /** Book-in to prep completion. */
  daysInPrep: number | null;
  blockedDays: number;
  workingDays: number;
  /** The single most expensive cause of delay on this card. */
  worstCause: { reason: PrepBlockReason; hours: number } | null;
}

/**
 * The card's headline numbers.
 *
 * `daysInPrep` is null while the card is open rather than "days so far" — a
 * completed-cars average that quietly includes in-flight cars is biased
 * downwards by every car still sitting on the board, which is exactly the
 * wrong direction for a metric a dealer is using to decide whether prep is
 * getting better.
 */
export function prepMetrics(
  card: { startedAt: Date; completedAt: Date | null },
  blocks: readonly PrepBlock[],
  asAt: Date,
): PrepMetrics {
  const window: Interval = closeWith(card.startedAt, card.completedAt, asAt);

  const merged = mergeIntervals(
    blocks
      .map((b) => clampInterval(closeWith(b.startedAt, b.endedAt, asAt), window))
      .filter((i): i is Interval => i !== null),
  );
  const blockedMs = intervalMs(merged);
  const elapsedMs = Math.max(0, window.end.getTime() - window.start.getTime());

  const byReason = new Map<PrepBlockReason, number>();
  for (const block of blocks) {
    const slice = clampInterval(closeWith(block.startedAt, block.endedAt, asAt), window);
    if (!slice) continue;
    byReason.set(
      block.reason,
      (byReason.get(block.reason) ?? 0) + (slice.end.getTime() - slice.start.getTime()),
    );
  }
  const worst = [...byReason.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    daysInPrep: card.completedAt === null ? null : round1(elapsedMs / MS_PER_DAY),
    blockedDays: round1(blockedMs / MS_PER_DAY),
    workingDays: round1(Math.max(0, elapsedMs - blockedMs) / MS_PER_DAY),
    worstCause: worst ? { reason: worst[0], hours: round1(worst[1] / MS_PER_HOUR) } : null,
  };
}

// ------------------------------------------------- the weekly report

export interface StageAverage {
  stageId: string;
  cards: number;
  averageWorkingHours: number;
  averageBlockedHours: number;
}

export interface PrepPerformance {
  completedCards: number;
  averageDaysInPrep: number | null;
  byStage: readonly StageAverage[];
  blockedDaysByCause: readonly { reason: PrepBlockReason; days: number }[];
  /** Not enough completed cars to say anything yet. */
  insufficientData: boolean;
}

/**
 * Below this many completed cards, the report says so rather than showing an
 * average. Same rule as M13's observed recon averages and M8's representative
 * APR report: a confident figure from three cars is worse than no figure,
 * because somebody changes how they run their workshop on the strength of it.
 */
export const MIN_CARDS_FOR_AVERAGE = 10;

export function prepPerformance(input: {
  cards: readonly {
    startedAt: Date;
    completedAt: Date | null;
    events: readonly StageEvent[];
    blocks: readonly PrepBlock[];
  }[];
  asAt: Date;
}): PrepPerformance {
  const completed = input.cards.filter((c) => c.completedAt !== null);

  const stageTotals = new Map<string, { working: number; blocked: number; cards: number }>();
  const causeTotals = new Map<PrepBlockReason, number>();
  let totalDays = 0;

  for (const card of completed) {
    const metrics = prepMetrics(card, card.blocks, input.asAt);
    totalDays += metrics.daysInPrep ?? 0;

    for (const duration of stageDurations(card.events, card.blocks, input.asAt)) {
      const entry = stageTotals.get(duration.stageId) ?? { working: 0, blocked: 0, cards: 0 };
      entry.working += duration.workingHours;
      entry.blocked += duration.blockedHours;
      entry.cards += 1;
      stageTotals.set(duration.stageId, entry);
    }

    // Merged per card, then summed — so one car waiting on two things for the
    // same week contributes one week, not two.
    for (const [reason, ms] of causeMs(card.blocks, card, input.asAt)) {
      causeTotals.set(reason, (causeTotals.get(reason) ?? 0) + ms);
    }
  }

  return {
    completedCards: completed.length,
    averageDaysInPrep:
      completed.length >= MIN_CARDS_FOR_AVERAGE ? round1(totalDays / completed.length) : null,
    byStage: [...stageTotals.entries()].map(([stageId, t]) => ({
      stageId,
      cards: t.cards,
      averageWorkingHours: round1(t.working / t.cards),
      averageBlockedHours: round1(t.blocked / t.cards),
    })),
    blockedDaysByCause: [...causeTotals.entries()]
      .map(([reason, ms]) => ({ reason, days: round1(ms / MS_PER_DAY) }))
      .sort((a, b) => b.days - a.days),
    insufficientData: completed.length < MIN_CARDS_FOR_AVERAGE,
  };
}

function causeMs(
  blocks: readonly PrepBlock[],
  card: { startedAt: Date; completedAt: Date | null },
  asAt: Date,
): Map<PrepBlockReason, number> {
  const window: Interval = closeWith(card.startedAt, card.completedAt, asAt);
  const totals = new Map<PrepBlockReason, number>();
  for (const block of blocks) {
    const slice = clampInterval(closeWith(block.startedAt, block.endedAt, asAt), window);
    if (!slice) continue;
    totals.set(
      block.reason,
      (totals.get(block.reason) ?? 0) + (slice.end.getTime() - slice.start.getTime()),
    );
  }
  return totals;
}

export const describeBlockReason = (reason: PrepBlockReason): string => ({
  awaiting_parts: 'Waiting for parts',
  awaiting_approval: 'Waiting for approval',
  awaiting_supplier_slot: 'Waiting for a supplier slot',
  awaiting_mot_slot: 'Waiting for an MOT slot',
  awaiting_decision: 'Waiting for a decision',
  awaiting_payment: 'Waiting for payment',
  other: 'Waiting',
}[reason]);

/** Convenience for the board card: total committed spend on a card. */
export const committedSpend = (
  tasks: readonly { estimate: Money | null; actual: Money | null }[],
  currency: 'GBP' | 'EUR' = 'GBP',
): Money =>
  sum(tasks.map((t) => t.actual ?? t.estimate ?? zero(currency)), currency);
