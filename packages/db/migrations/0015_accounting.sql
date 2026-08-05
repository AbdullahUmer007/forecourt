-- =====================================================================
-- M17 — Accounting sync.
--
-- Expand-only. Rollback: 0015_accounting.down.sql
-- Depends on 0009_money (invoices, payments, stock_book_entries).
--
-- The functional spec states the constraint this whole module lives under, and
-- it is worth quoting rather than paraphrasing:
--
--   "We are not the ledger. We are the source of accurate, VAT-correct
--    transactional data. Never invent journal entries the accountant did not
--    agree to; always allow the accountant read-only access to check us."
--
-- Three things follow, and they shape every table here:
--
--   1. NOTHING POSTS TO AN ACCOUNT THE ACCOUNTANT HAS NOT MAPPED. Not a
--      sensible default, not a best guess, not "Sales" because it sounded
--      right. `account_mappings` is the agreement, and a posting that touches
--      an unmapped key is refused rather than sent somewhere plausible. A
--      wrong account is worse than a missing one: a missing one gets noticed
--      at month end, a wrong one gets reconciled and forgotten.
--
--   2. THE MARGIN VAT JOURNAL IS SEPARATE FROM THE SALES INVOICE, AND BOTH
--      ARE MANDATORY. A margin-scheme invoice carries no output VAT — M11
--      enforces that at four layers because showing it standard-rates the
--      whole sale. But the dealer still owes VAT on the margin, and it has to
--      reach the VAT control account somehow. It goes as its own journal. Post
--      only the invoice and the dealer underpays VAT; put the VAT on the
--      invoice and the sale becomes standard-rated. Both mistakes are ours to
--      prevent.
--
--   3. NOTHING POSTS TWICE. Every posting carries an idempotency key and the
--      external id it created, so a retried batch reconciles rather than
--      duplicating. A duplicated sales invoice in a dealer's Xero is a day of
--      somebody's life to unpick.
-- =====================================================================

BEGIN;

CREATE TYPE accounting_provider AS ENUM ('xero', 'quickbooks', 'sage', 'csv_export');

CREATE TYPE posting_source AS ENUM (
  'sales_invoice', 'credit_note', 'purchase_invoice', 'payment', 'margin_vat_journal'
);

CREATE TYPE posting_status AS ENUM (
  'pending', 'dry_run', 'posted', 'failed', 'skipped', 'blocked'
);

CREATE TYPE batch_status AS ENUM ('building', 'dry_run', 'posting', 'complete', 'failed');

-- ---------------------------------------------------------- connections
CREATE TABLE accounting_connections (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),

  provider          accounting_provider NOT NULL,
  -- The accountant's own name for the company file, so a dealer with two
  -- entities can tell which one they connected.
  organisation_name text,
  credentials_ref   text,

  enabled           boolean NOT NULL DEFAULT false,
  -- Nothing posts for real until this is set. The spec's dry-run requirement
  -- is not a mode a user picks; it is the state a connection starts in.
  live_from         timestamptz,

  last_sync_at      timestamptz,
  last_error        text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),
  updated_by        uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX accounting_connections_tenant_provider_unique
  ON accounting_connections (tenant_id, provider);

-- ------------------------------------------------------------- mappings
--
-- The agreement with the accountant, one row per internal key. `account_code`
-- is theirs; `account_key` is ours and is a closed set in the domain layer, so
-- a new key added by us shows up as an unmapped blocker rather than silently
-- posting nowhere.
CREATE TABLE account_mappings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  connection_id   uuid NOT NULL REFERENCES accounting_connections(id),

  account_key     text NOT NULL,
  account_code    text NOT NULL,
  account_name    text,

  -- Their tax rate identifier for this key, where one applies. Null on a
  -- margin key, because there is no VAT rate on a margin sale — that is the
  -- whole point of the scheme.
  tax_rate_code   text,

  -- Who agreed it and when. "Never invent journal entries the accountant did
  -- not agree to" is unverifiable without this.
  agreed_by       uuid REFERENCES users(id),
  agreed_at       timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_mapping_key_not_blank CHECK (length(btrim(account_key)) > 0),
  CONSTRAINT account_mapping_code_not_blank CHECK (length(btrim(account_code)) > 0)
);
CREATE UNIQUE INDEX account_mappings_unique
  ON account_mappings (tenant_id, connection_id, account_key);

-- -------------------------------------------------------------- batches
CREATE TABLE posting_batches (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  connection_id   uuid NOT NULL REFERENCES accounting_connections(id),

  status          batch_status NOT NULL DEFAULT 'building',
  dry_run         boolean NOT NULL DEFAULT true,

  period_start    date,
  period_end      date,

  total_count     integer NOT NULL DEFAULT 0,
  posted_count    integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  blocked_count   integer NOT NULL DEFAULT 0,

  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  created_by      uuid REFERENCES users(id),

  CONSTRAINT batch_counts_non_negative CHECK (
    total_count >= 0 AND posted_count >= 0 AND failed_count >= 0 AND blocked_count >= 0
  ),
  CONSTRAINT batch_period_ordered CHECK (
    period_start IS NULL OR period_end IS NULL OR period_end >= period_start
  )
);
CREATE INDEX posting_batches_tenant_idx ON posting_batches (tenant_id, started_at DESC);

-- ------------------------------------------------------------ postings
--
-- One row per document per batch. The error queue §23 asks for IS this table
-- filtered to `failed` and `blocked`, which is why the reason is a sentence
-- rather than a code.
CREATE TABLE postings (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  connection_id     uuid NOT NULL REFERENCES accounting_connections(id),
  batch_id          uuid REFERENCES posting_batches(id),

  source            posting_source NOT NULL,
  -- The invoice, payment or stock-book entry this came from. Not a foreign
  -- key because it points at three different tables depending on `source`,
  -- and a nullable FK per table would be worse than a documented id.
  source_id         uuid NOT NULL,

  status            posting_status NOT NULL DEFAULT 'pending',

  -- What we sent, or would have sent. Kept for a dry run too — the whole
  -- value of a dry run is being able to read it.
  lines             jsonb NOT NULL,
  total_debit_pence bigint NOT NULL,
  total_credit_pence bigint NOT NULL,
  currency          text NOT NULL DEFAULT 'GBP',

  -- Rule 8, and the thing that stops a retried batch duplicating a dealer's
  -- sales invoices in their own Xero.
  idempotency_key   text NOT NULL,
  external_id       text,

  -- A sentence, not a code. The person reading the error queue is the
  -- dealer's bookkeeper.
  message           text,
  attempts          integer NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT posting_key_not_blank CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT posting_attempts_non_negative CHECK (attempts >= 0),
  -- Double entry, enforced by the database as well as by the domain layer.
  -- An unbalanced posting is not a thing that should be storable, let alone
  -- sendable.
  CONSTRAINT posting_balances CHECK (total_debit_pence = total_credit_pence),
  CONSTRAINT posting_failure_has_message CHECK (
    status NOT IN ('failed', 'blocked') OR message IS NOT NULL
  ),
  CONSTRAINT posting_posted_has_external_id CHECK (
    status <> 'posted' OR external_id IS NOT NULL
  )
);
-- One live posting per document per connection. A retry updates this row; it
-- does not add another.
CREATE UNIQUE INDEX postings_idempotency_unique
  ON postings (tenant_id, connection_id, idempotency_key);
CREATE INDEX postings_batch_idx ON postings (tenant_id, batch_id);
-- The error queue.
CREATE INDEX postings_problems_idx ON postings (tenant_id, status, updated_at DESC)
  WHERE status IN ('failed', 'blocked');
CREATE INDEX postings_source_idx ON postings (tenant_id, source, source_id);

SELECT * FROM apply_tenant_policies();

COMMIT;
