-- =====================================================================
-- M18 — Reporting and the Channel P&L.
--
-- Expand-only. Rollback: 0016_reporting.down.sql
-- Depends on 0008_leads, 0009_money, 0010_deals, 0013_channels.
--
-- Most of this module is queries over tables that already exist — a report is
-- a question, not a place to keep things. Only three things genuinely need
-- storing, and one of them is the point of the whole module.
--
-- THE CHANNEL P&L is what the spec calls "the most persuasive screen in the
-- product": it reframes our subscription as the cheapest channel the dealer
-- has, and gives them the ammunition they currently lack when a marketplace
-- puts its prices up. It needs one thing we do not otherwise hold — what the
-- dealer ACTUALLY spent on each channel in each month.
--
-- `channels.monthly_cost_pence` from M16 is a standing figure: what the
-- contract says. `channel_costs` is what the invoice said. They differ every
-- time there is a promotion, an overage charge or a mid-month change, and a
-- P&L built on the standing figure is a P&L the dealer can disprove with a
-- bank statement — which is the fastest way to lose the argument the table
-- exists to win.
-- =====================================================================

BEGIN;

CREATE TYPE report_format AS ENUM ('csv', 'xlsx', 'pdf');
CREATE TYPE schedule_period AS ENUM ('daily', 'weekly', 'monthly', 'quarterly');

-- --------------------------------------------------------- channel cost
--
-- What was actually spent, per channel, per month. Entered by the dealer or
-- pulled from an invoice; either way it is an ACTUAL, not a contract rate.
CREATE TABLE channel_costs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  site_id         uuid REFERENCES sites(id),

  -- Nullable so a dealer can record spend for a channel they have not
  -- connected — most of them are advertising somewhere we do not integrate
  -- with, and leaving that out of the P&L makes the table flattering rather
  -- than useful.
  channel_id      uuid REFERENCES channels(id),
  channel_label   text NOT NULL,

  -- The month this spend belongs to. Stored as the first day, so a unique
  -- index can hold "one figure per channel per month" without date ranges.
  period_month    date NOT NULL,

  amount_pence    bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'GBP',
  -- Marks a figure the dealer has not confirmed yet, so the P&L can say so
  -- rather than presenting an estimate as fact.
  estimated       boolean NOT NULL DEFAULT false,
  note            text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),
  updated_by      uuid REFERENCES users(id),

  CONSTRAINT channel_cost_non_negative CHECK (amount_pence >= 0),
  CONSTRAINT channel_cost_label_not_blank CHECK (length(btrim(channel_label)) > 0),
  -- The first of the month, always. Otherwise "one figure per month" is a
  -- convention rather than a constraint.
  CONSTRAINT channel_cost_period_is_month_start CHECK (
    date_trunc('month', period_month) = period_month
  )
);
CREATE UNIQUE INDEX channel_costs_unique
  ON channel_costs (tenant_id, channel_label, period_month,
                    coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX channel_costs_period_idx ON channel_costs (tenant_id, period_month DESC);

-- -------------------------------------------------------- saved reports
CREATE TABLE saved_reports (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),

  report_key      text NOT NULL,
  name            text NOT NULL,
  -- The filters, as the report screen understands them. Deliberately jsonb:
  -- every report has different ones and a column per filter would be a
  -- migration every time somebody adds a dropdown.
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Null means private to its owner. A shared view is one the whole
  -- dealership sees, which is how a manager stops everyone building their own
  -- slightly different version of the same number.
  shared          boolean NOT NULL DEFAULT false,
  owner_id        uuid REFERENCES users(id),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saved_report_key_not_blank CHECK (length(btrim(report_key)) > 0),
  CONSTRAINT saved_report_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE INDEX saved_reports_tenant_idx ON saved_reports (tenant_id, report_key);

-- ------------------------------------------------------------ schedules
--
-- §26.2's scheduled email delivery. The recipients are stored as user ids
-- rather than addresses: a scheduled report that keeps emailing somebody who
-- left the dealership is a data-protection problem with a calendar entry.
CREATE TABLE report_schedules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  saved_report_id uuid NOT NULL REFERENCES saved_reports(id),

  period          schedule_period NOT NULL,
  format          report_format NOT NULL DEFAULT 'csv',
  recipient_ids   uuid[] NOT NULL DEFAULT '{}',

  enabled         boolean NOT NULL DEFAULT true,
  next_run_at     timestamptz,
  last_run_at     timestamptz,
  last_error      text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),

  CONSTRAINT report_schedule_has_recipients CHECK (
    NOT enabled OR array_length(recipient_ids, 1) > 0
  )
);
CREATE INDEX report_schedules_due_idx ON report_schedules (tenant_id, next_run_at)
  WHERE enabled;

SELECT * FROM apply_tenant_policies();

COMMIT;
