import { requireSession } from '@/auth/session';
import { loadBoard, type BoardCard } from '@/data/prep';
import { StatusBadge, Empty, Amount, Reg, type Tone } from '@/components/ui';
import { MoveControl } from '@/components/move-control';
import {
  stageDurations, stageSlaState, prepMetrics, costPosition, describeBlockReason,
  holds, zero, type PrepStage,
} from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * The prep board.
 *
 * §7.1 says a kanban board; AC1 says it must be usable one-handed on a phone
 * in a workshop. Those pull in opposite directions, so the layout is two
 * shapes rather than one squeezed: columns side by side from `lg`, and a
 * single stacked column below it — which is the shape someone standing over a
 * car actually wants, because a horizontally-scrolling board needs two hands
 * and a flat surface.
 *
 * Every duration on this page comes from the domain layer. The view does not
 * subtract two dates anywhere.
 */
export default async function PrepBoard() {
  const session = await requireSession();
  const board = await loadBoard(session);
  const now = new Date();

  const canMove = holds(
    { userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
      permissions: session.permissions, scope: session.scope, siteIds: session.siteIds },
    'vehicle.update',
  );

  // Cost is cost data — a prep user can see the board without seeing spend.
  const canSeeCost = holds(
    { userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
      permissions: session.permissions, scope: session.scope, siteIds: session.siteIds },
    'vehicle.cost.read',
  );

  if (board.stages.length === 0) {
    return (
      <Empty title="No prep stages set up">
        The board needs stages before cars can move through it. Run
        {' '}<code className="mono">pnpm db:seed:prep</code>{' '}
        for the ten default stages, or add your own — a dealer with no bodyshop
        should not be looking at a Bodywork column.
      </Empty>
    );
  }

  const totalBlocked = board.cards
    .map((c) => prepMetrics(c, c.blocks, now).blockedDays)
    .reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Prep</h1>
        <p className="text-ink-muted">
          {board.cards.length} car{board.cards.length === 1 ? '' : 's'} in prep
          {totalBlocked > 0 && (
            <>
              {' · '}
              <strong className="text-warning-ink">
                {Math.round(totalBlocked)} day{Math.round(totalBlocked) === 1 ? '' : 's'} waiting
              </strong>
              {' '}across the board
            </>
          )}
        </p>
      </div>

      {board.cards.length === 0 ? (
        <Empty title="Nothing in prep">
          Cars appear here when they are booked in. The board tracks not just how long each one
          takes, but how much of that time it spent waiting — for a part, an approval, a
          bodyshop slot — which is usually the half a dealer can actually fix.
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-flow-col lg:auto-cols-[minmax(280px,1fr)] lg:overflow-x-auto lg:pb-2">
          {board.stages.map((stage) => {
            const cards = board.cards.filter((c) => c.currentStageId === stage.id);
            // A stage with nothing in it is hidden on a phone — an empty
            // column is noise when you are scrolling one-handed — but kept on
            // a wide screen, where the shape of the board is the information.
            return (
              <section
                key={stage.id}
                className={cards.length === 0 ? 'hidden lg:block' : ''}
              >
                <header className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-[16px] leading-6 font-semibold">{stage.name}</h2>
                  <span className="text-ink-subtle">
                    {cards.length}
                    {stage.slaHours !== null && ` · ${stage.slaHours}h`}
                  </span>
                </header>

                <div className="grid gap-2">
                  {cards.map((card) => (
                    <PrepCardView
                      key={card.id}
                      card={card}
                      stage={stage}
                      stages={board.stages}
                      minimumPhotos={board.minimumPhotos}
                      canMove={canMove}
                      canSeeCost={canSeeCost}
                      now={now}
                    />
                  ))}
                  {cards.length === 0 && (
                    <p className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-[13px] leading-[18px] text-ink-subtle">
                      Empty
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function PrepCardView(
  { card, stage, stages, minimumPhotos, canMove, canSeeCost, now }: {
    card: BoardCard;
    stage: PrepStage;
    stages: readonly PrepStage[];
    minimumPhotos: number;
    canMove: boolean;
    canSeeCost: boolean;
    now: Date;
  },
) {
  const durations = stageDurations(card.events, card.blocks, now);
  const current = durations.find((d) => d.stageId === stage.id && d.open)
    ?? durations.filter((d) => d.stageId === stage.id).at(-1);
  const sla = current ? stageSlaState(current, stage) : null;
  const metrics = prepMetrics(card, card.blocks, now);

  const openBlocks = card.blocks.filter((b) => b.endedAt === null);
  const cost = costPosition(
    card.budget,
    card.tasks.map((t) => t.estimate ?? zero('GBP')),
  );
  const unapproved = card.tasks.filter(
    (t) => t.approvalRequired && t.approvedAt === null && t.status !== 'declined',
  );

  const description = [card.make, card.model].filter(Boolean).join(' ');
  const photoGate = stage.requiresMinPhotos && card.publishedPhotoCount < minimumPhotos;

  return (
    <article className="rounded-md border border-edge bg-surface-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Reg value={card.registration} />
        <span className="min-w-0 flex-1 truncate font-medium">{description || 'Vehicle'}</span>
      </div>

      {/* Days in this stage against the target, and — the point of the whole
          module — how much of it was waiting rather than working. */}
      {current && sla && (
        <p className="mt-2 text-[13px] leading-[18px]">
          <span className={sla.breached ? 'font-medium text-warning-ink' : 'text-ink-muted'}>
            {Math.round(current.elapsedHours)}h in {stage.name.toLowerCase()}
          </span>
          {current.blockedHours > 0 && (
            <span className="text-ink-muted">
              {' — '}
              <strong className="text-warning-ink">
                {Math.round(current.blockedHours)}h waiting
              </strong>
              , {Math.round(current.workingHours)}h worked
            </span>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {sla?.breached && (
          <StatusBadge tone="warning" icon="⏱" label={`${Math.round(sla.hoursOver)}h over target`} />
        )}
        {openBlocks.map((block) => (
          <StatusBadge
            key={block.id}
            tone="serious"
            icon="⏸"
            label={describeBlockReason(block.reason)}
          />
        ))}
        {photoGate && (
          <StatusBadge
            tone="critical"
            icon="✕"
            label={`${card.publishedPhotoCount}/${minimumPhotos} photos`}
          />
        )}
        {unapproved.length > 0 && (
          <StatusBadge tone="warning" icon="!" label={`${unapproved.length} awaiting approval`} />
        )}
        {canSeeCost && cost.overBudget && (
          <StatusBadge tone="warning" icon="£" label="Over budget" />
        )}
      </div>

      {/* The blocking issue, said in words. A badge tells you there is a
          problem; the note tells you what to chase. */}
      {openBlocks.filter((b) => b.note).map((block) => (
        <p key={block.id} className="mt-2 text-[13px] leading-[18px] text-ink-muted">
          {block.note}
        </p>
      ))}

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-ink-subtle">
        {card.ownerName && (
          <div><dt className="inline">Owner </dt><dd className="inline">{card.ownerName}</dd></div>
        )}
        {canSeeCost && (
          <div>
            <dt className="inline">Spend </dt>
            <dd className="inline">
              <Amount value={cost.committed} />
              {card.budget && <> of <Amount value={card.budget} /></>}
            </dd>
          </div>
        )}
        {metrics.blockedDays > 0 && (
          <div>
            <dt className="inline">Waited </dt>
            <dd className="inline">{metrics.blockedDays}d total</dd>
          </div>
        )}
      </dl>

      {canMove && (
        <MoveControl
          cardId={card.id}
          currentStageId={stage.id}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}
    </article>
  );
}

/** Status tone for a task, kept beside the board so both agree. */
export const TASK_TONE: Record<string, Tone> = {
  suggested: 'neutral', planned: 'neutral', approved: 'info',
  in_progress: 'info', blocked: 'serious', done: 'good', declined: 'neutral',
};
