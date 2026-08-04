-- =====================================================================
-- M14 — Preparation (reconditioning) pipeline.
--
-- Expand-only. Rollback: 0012_prep.down.sql
-- Depends on 0002_vehicles (vehicles, vehicle_costs, cost_category).
--
-- The functional spec calls this "where we prove ROI" and says to treat it
-- as a first-class product. The ROI claim is narrow and it is worth stating
-- precisely, because it decides the schema:
--
--   A dealer's prep problem is almost never that the work takes too long.
--   It is that the car SITS — waiting for a part, a decision, an approval, a
--   bodyshop slot. A board that reports "eleven days in Bodywork" tells them
--   nothing they can act on. A board that reports "eleven days in Bodywork,
--   of which nine were waiting for a wing" tells them exactly what to fix.
--
-- So the load-bearing table here is `prep_blocks`, and the load-bearing
-- distinction is BLOCKED time versus WORKING time. Everything else is
-- bookkeeping around it.
--
-- Three consequences:
--
--   1. Stage history is its own append-only-ish table rather than a column
--      on the card. "Days in current stage" is a column you can keep
--      accurate; "days per stage, per month, versus the baseline" is not,
--      and AC2 asks for the second one.
--
--   2. Blocks are periods with a CAUSE, and they overlap freely — a car can
--      wait for a part and an approval at the same time. The domain layer
--      merges overlapping periods so that never double-counts; the schema's
--      job is only to record them honestly.
--
--   3. Money is NOT duplicated here. A prep task points at a `vehicle_costs`
--      row, which M3 already owns and which the vehicle's `total_cost_pence`
--      already aggregates. A second source of truth for spend would drift
--      from the margin panel within a week.
-- =====================================================================

BEGIN;

CREATE TYPE prep_task_status AS ENUM (
  'suggested', 'planned', 'approved', 'in_progress', 'blocked', 'done', 'declined'
);

-- Where a suggested task came from. `mot_advisory` is the one that matters:
-- §5.3 of the spec turns the last MOT's advisories into work items
-- automatically, and a dealer noticing that is how the module sells itself.
CREATE TYPE prep_task_source AS ENUM ('manual', 'mot_advisory', 'appraisal', 'standard_plan');

-- Why a car is sitting. Named individually rather than free text because the
-- weekly report groups by them, and "other" with a note is the escape hatch
-- rather than the default.
CREATE TYPE prep_block_reason AS ENUM (
  'awaiting_parts', 'awaiting_approval', 'awaiting_supplier_slot',
  'awaiting_mot_slot', 'awaiting_decision', 'awaiting_payment', 'other'
);

-- --------------------------------------------------------- prep stages
--
-- Configurable per tenant. The defaults are seeded by provisioning, not
-- hard-coded here — a dealer with no bodyshop should be able to delete
-- Bodywork rather than look at an empty column forever.
CREATE TABLE prep_stages (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),

  key                 text NOT NULL,
  name                text NOT NULL,
  position            integer NOT NULL,

  -- The SLA for this stage, in hours. Null means "no target" rather than
  -- zero, which would make every card instantly in breach.
  sla_hours           integer,

  -- The photography gate. A stage flagged here cannot be left until the
  -- vehicle carries at least the tenant's minimum published photo count —
  -- §7.4, and it is enforced in the domain layer because the count itself is
  -- maintained by M5's trigger.
  requires_min_photos boolean NOT NULL DEFAULT false,
  -- Reaching this stage means prep is finished.
  is_final            boolean NOT NULL DEFAULT false,
  archived_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),

  CONSTRAINT prep_stage_key_not_blank CHECK (length(btrim(key)) > 0),
  CONSTRAINT prep_stage_position_positive CHECK (position > 0),
  CONSTRAINT prep_stage_sla_positive CHECK (sla_hours IS NULL OR sla_hours > 0)
);
CREATE UNIQUE INDEX prep_stages_tenant_key_unique ON prep_stages (tenant_id, key);
CREATE INDEX prep_stages_board_idx ON prep_stages (tenant_id, position)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------- prep cards
--
-- One card per vehicle per prep run. A returned CRA rejection goes through
-- prep again, and that is a second run rather than an edit of the first —
-- otherwise the days metrics silently blend two different pieces of work.
CREATE TABLE prep_cards (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  site_id           uuid REFERENCES sites(id),
  vehicle_id        uuid NOT NULL REFERENCES vehicles(id),

  current_stage_id  uuid REFERENCES prep_stages(id),
  owner_id          uuid REFERENCES users(id),

  -- What this car was expected to cost to prepare. The variance against it is
  -- half of the weekly report, and a null budget means "not set" rather than
  -- zero, so an unbudgeted card is not reported as 100% over.
  budget_pence      bigint,
  currency          text NOT NULL DEFAULT 'GBP',

  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),
  updated_by        uuid REFERENCES users(id),

  CONSTRAINT prep_card_budget_non_negative CHECK (budget_pence IS NULL OR budget_pence >= 0),
  CONSTRAINT prep_card_completed_after_started CHECK (
    completed_at IS NULL OR completed_at >= started_at
  )
);
-- A vehicle has at most ONE open prep card. Two would mean two boards
-- disagreeing about where the car is.
CREATE UNIQUE INDEX prep_cards_one_open_per_vehicle
  ON prep_cards (tenant_id, vehicle_id) WHERE completed_at IS NULL;
CREATE INDEX prep_cards_board_idx ON prep_cards (tenant_id, current_stage_id)
  WHERE completed_at IS NULL;
CREATE INDEX prep_cards_vehicle_idx ON prep_cards (tenant_id, vehicle_id);

-- -------------------------------------------------- stage history
--
-- Every entry into a stage, with when it was left. This is what AC2's
-- "days per vehicle, per stage, per month" is computed from, and it is why
-- the card does not simply carry a `stage_entered_at` column: that answers
-- "how long has it been here" and nothing else.
CREATE TABLE prep_stage_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  card_id       uuid NOT NULL REFERENCES prep_cards(id),
  stage_id      uuid NOT NULL REFERENCES prep_stages(id),

  entered_at    timestamptz NOT NULL,
  exited_at     timestamptz,
  moved_by      uuid REFERENCES users(id),
  note          text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prep_stage_event_ordered CHECK (
    exited_at IS NULL OR exited_at >= entered_at
  )
);
CREATE INDEX prep_stage_events_card_idx ON prep_stage_events (tenant_id, card_id, entered_at);
CREATE INDEX prep_stage_events_stage_idx ON prep_stage_events (tenant_id, stage_id, entered_at DESC);
-- A card is in exactly one stage at a time.
CREATE UNIQUE INDEX prep_stage_events_one_open_per_card
  ON prep_stage_events (card_id) WHERE exited_at IS NULL;

-- ------------------------------------------------------------- tasks
--
-- The job card's line items. Money lives in `vehicle_costs`, which M3 owns
-- and the vehicle's cached total already aggregates; `vehicle_cost_id` is the
-- link. Duplicating the amount here would give the margin panel and the prep
-- board two different answers about the same car.
CREATE TABLE prep_tasks (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  card_id           uuid NOT NULL REFERENCES prep_cards(id),

  description       text NOT NULL,
  category          cost_category NOT NULL,
  status            prep_task_status NOT NULL DEFAULT 'planned',
  source            prep_task_source NOT NULL DEFAULT 'manual',
  -- The advisory text this was suggested from, kept verbatim so a dealer can
  -- see it came from the MOT rather than from us.
  source_detail     text,

  assigned_to       uuid REFERENCES users(id),
  supplier_name     text,
  due_on            date,

  -- Estimated here so a task can be costed before it is committed; the ACTUAL
  -- spend is the linked vehicle_costs row and is not repeated.
  estimate_pence    bigint,
  currency          text NOT NULL DEFAULT 'GBP',
  vehicle_cost_id   uuid REFERENCES vehicle_costs(id),

  -- §7.2's approval threshold. Recorded on the task rather than inferred, so
  -- raising the threshold later does not retrospectively un-approve work.
  approval_required boolean NOT NULL DEFAULT false,
  approved_by       uuid REFERENCES users(id),
  approved_at       timestamptz,

  started_at        timestamptz,
  completed_at      timestamptz,
  declined_reason   text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),
  updated_by        uuid REFERENCES users(id),

  CONSTRAINT prep_task_description_not_blank CHECK (length(btrim(description)) > 0),
  CONSTRAINT prep_task_estimate_non_negative CHECK (
    estimate_pence IS NULL OR estimate_pence >= 0
  ),
  -- Work that needed approval cannot be marked done without it. The threshold
  -- exists so a valeter cannot commit a £900 bodyshop job; a threshold that
  -- only warns is a threshold nobody follows.
  CONSTRAINT prep_task_approved_before_done CHECK (
    NOT (approval_required AND approved_at IS NULL AND status IN ('in_progress', 'done'))
  ),
  CONSTRAINT prep_task_declined_has_reason CHECK (
    status <> 'declined' OR declined_reason IS NOT NULL
  )
);
CREATE INDEX prep_tasks_card_idx ON prep_tasks (tenant_id, card_id);
CREATE INDEX prep_tasks_open_idx ON prep_tasks (tenant_id, status, due_on)
  WHERE status NOT IN ('done', 'declined');

-- ------------------------------------------------------------- parts
CREATE TABLE prep_parts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  task_id       uuid NOT NULL REFERENCES prep_tasks(id),

  description   text NOT NULL,
  part_number   text,
  supplier_name text,
  quantity      integer NOT NULL DEFAULT 1,

  ordered_on    date,
  expected_on   date,
  received_on   date,

  cost_pence    bigint,
  currency      text NOT NULL DEFAULT 'GBP',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),

  CONSTRAINT prep_part_quantity_positive CHECK (quantity > 0),
  CONSTRAINT prep_part_cost_non_negative CHECK (cost_pence IS NULL OR cost_pence >= 0),
  CONSTRAINT prep_part_received_after_ordered CHECK (
    received_on IS NULL OR ordered_on IS NULL OR received_on >= ordered_on
  )
);
CREATE INDEX prep_parts_task_idx ON prep_parts (tenant_id, task_id);
-- The list that matters on a Monday morning: ordered, not arrived.
CREATE INDEX prep_parts_outstanding_idx ON prep_parts (tenant_id, expected_on)
  WHERE received_on IS NULL;

-- ------------------------------------------------------------ blocks
--
-- THE table. A period during which the car was not being worked on, and why.
--
-- Blocks overlap freely and that is correct: a car can wait for a part and a
-- manager's approval at the same time. The domain layer merges overlapping
-- periods before reporting, so two simultaneous causes are one blocked day
-- rather than two — getting that wrong would let a dealer report more blocked
-- time than the car has been in stock, which destroys the credibility of the
-- one number this module exists to produce.
CREATE TABLE prep_blocks (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  card_id       uuid NOT NULL REFERENCES prep_cards(id),
  task_id       uuid REFERENCES prep_tasks(id),

  reason        prep_block_reason NOT NULL,
  note          text,

  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  raised_by     uuid REFERENCES users(id),

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prep_block_ordered CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- "other" without a note is a block nobody can act on, and it becomes the
  -- default the moment it is allowed to be empty.
  CONSTRAINT prep_block_other_has_note CHECK (
    reason <> 'other' OR (note IS NOT NULL AND length(btrim(note)) > 0)
  )
);
CREATE INDEX prep_blocks_card_idx ON prep_blocks (tenant_id, card_id, started_at);
CREATE INDEX prep_blocks_open_idx ON prep_blocks (tenant_id, reason)
  WHERE ended_at IS NULL;

-- ----------------------------------------------------- frozen history
--
-- Stage events and blocks are what the days metrics are computed from, and
-- those metrics are the module's entire value. Neither is blanket append-only
-- — each has exactly one lawful update, which is being closed — so they use
-- the same content-freeze shape as M12's repair attempts and M13's
-- settlements rather than `make_append_only`.
--
-- Back-dating a stage entry or a block start rewrites how long a car sat,
-- which is the number a dealer is about to make a decision on.
CREATE OR REPLACE FUNCTION freeze_prep_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  started_col text := CASE TG_TABLE_NAME WHEN 'prep_blocks' THEN 'started_at' ELSE 'entered_at' END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'A % row cannot be deleted — it records how long a car actually sat.', TG_TABLE_NAME;
  END IF;

  IF TG_TABLE_NAME = 'prep_blocks' THEN
    IF NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.card_id IS DISTINCT FROM OLD.card_id THEN
      RAISE EXCEPTION
        'The start and cause of a block are fixed. Close it and raise a new one instead.';
    END IF;
    IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      RAISE EXCEPTION 'A block that has been closed cannot be re-dated.';
    END IF;
  ELSE
    IF NEW.entered_at IS DISTINCT FROM OLD.entered_at
       OR NEW.stage_id IS DISTINCT FROM OLD.stage_id
       OR NEW.card_id IS DISTINCT FROM OLD.card_id THEN
      RAISE EXCEPTION
        'The stage and entry time of a stage event are fixed — they are the days metric.';
    END IF;
    IF OLD.exited_at IS NOT NULL AND NEW.exited_at IS DISTINCT FROM OLD.exited_at THEN
      RAISE EXCEPTION 'A stage that has been left cannot be re-dated.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER freeze_period
  BEFORE UPDATE OR DELETE ON prep_stage_events
  FOR EACH ROW EXECUTE FUNCTION freeze_prep_period();

CREATE TRIGGER freeze_period
  BEFORE UPDATE OR DELETE ON prep_blocks
  FOR EACH ROW EXECUTE FUNCTION freeze_prep_period();

SELECT * FROM apply_tenant_policies();

COMMIT;
