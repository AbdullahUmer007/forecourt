-- =====================================================================
-- M9 — Contacts & consent.
--
-- Expand-only. Rollback: 0007_contacts.down.sql
-- Depends on 0001_tenancy.sql and 0005_search.sql.
--
-- The rule this module exists to enforce (CLAUDE.md rule 7):
--
--   Consent is a RECORD, never a boolean — channel, basis, source,
--   timestamp, wording version — and it is re-checked AT SEND TIME.
--
-- A `marketing_opt_in boolean` column cannot answer any of the questions an
-- ICO investigation actually asks: which channel, on what lawful basis, from
-- what source, on what date, and showing exactly what words. So there is no
-- such column anywhere in this migration, and `contact_consents` is
-- append-only at the database level so a withdrawal can never be "corrected"
-- by editing the row that granted it.
-- =====================================================================

BEGIN;

-- A basis is not a preference. PECR reg. 22 soft opt-in is a genuinely
-- different lawful basis from explicit consent and has four conditions that
-- must ALL hold; legitimate interest cannot support unsolicited email or SMS
-- marketing to an individual at all. Keeping them as distinct values means the
-- validator can enforce each one's own rules rather than treating consent as
-- a single yes/no.
CREATE TYPE consent_basis AS ENUM ('explicit', 'soft_opt_in', 'legitimate_interest');

-- Channels are separate records. Consent to email is not consent to SMS, and
-- a buyer who agrees to a phone call has not agreed to a WhatsApp message.
CREATE TYPE consent_channel AS ENUM ('email', 'sms', 'phone', 'post', 'whatsapp');

-- Where the record came from. This is what makes a consent auditable — an
-- aggregator lead cannot rely on the dealer's own soft opt-in, so the source
-- has to survive into the record rather than being lost at import.
CREATE TYPE consent_source AS ENUM (
  'website_form', 'in_person', 'telephone', 'import', 'aggregator', 'staff_entry'
);

CREATE TYPE contact_kind AS ENUM ('individual', 'business');

-- Vulnerability is FG21/1, not a free-text note. The categories are the FCA's
-- four drivers, so a dealer's records line up with the guidance they will be
-- assessed against.
CREATE TYPE vulnerability_driver AS ENUM ('health', 'life_event', 'resilience', 'capability');

-- ---------------------------------------------------------------- contacts
--
-- One person or business, per tenant. Deliberately NOT globally unique on
-- email: the same buyer may deal with two dealers on this platform, and those
-- must be two independent records with independent consent. A global unique
-- index would also leak the existence of another dealer's customer through a
-- constraint violation — the same reasoning as `vehicles.registration`.
CREATE TABLE contacts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  site_id           uuid REFERENCES sites(id),

  kind              contact_kind NOT NULL DEFAULT 'individual',

  -- Names are optional because a valid lead can arrive as an email address and
  -- nothing else. Requiring a name here would push staff into typing "Unknown".
  first_name        text,
  last_name         text,
  company_name      text,

  email             text,
  phone             text,

  address_line1     text,
  address_line2     text,
  locality          text,
  postcode          text,
  country           text NOT NULL DEFAULT 'GB',

  notes             text,

  -- Vulnerability. Access to these two columns is permission-gated in the
  -- repository layer (`contact.vulnerability.read`); they are separated from
  -- `notes` so that gating is possible at all.
  vulnerability_drivers vulnerability_driver[] NOT NULL DEFAULT '{}',
  vulnerability_note    text,

  -- Set when this contact was merged into another. The row is KEPT rather than
  -- deleted, because its consent history is evidence and must remain
  -- addressable from the audit trail.
  merged_into_id    uuid REFERENCES contacts(id),

  -- A legal hold blocks erasure. A finance introduction under the redress
  -- look-back must survive a routine "delete my data" request, and the refusal
  -- has to be defensible — so the hold is a column with a reason, not a
  -- convention.
  legal_hold        boolean NOT NULL DEFAULT false,
  legal_hold_reason text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),
  updated_by        uuid REFERENCES users(id),

  -- Erasure is a timestamp plus scrubbed fields, never a DROP: the contact's
  -- deal and evidence rows reference this id, and a dangling reference in a
  -- compliance record is worse than a tombstone.
  erased_at         timestamptz,

  CONSTRAINT contact_has_some_identity CHECK (
    email IS NOT NULL OR phone IS NOT NULL
    OR first_name IS NOT NULL OR last_name IS NOT NULL OR company_name IS NOT NULL
  ),
  CONSTRAINT contact_legal_hold_has_reason CHECK (
    legal_hold = false OR legal_hold_reason IS NOT NULL
  ),
  CONSTRAINT contact_vulnerability_note_needs_driver CHECK (
    vulnerability_note IS NULL OR cardinality(vulnerability_drivers) > 0
  )
);

-- Tenant-first, as every index in this codebase is. Lower() so a search for
-- an address a customer typed in caps still finds them.
CREATE INDEX contacts_tenant_email_idx ON contacts (tenant_id, lower(email));
CREATE INDEX contacts_tenant_phone_idx ON contacts (tenant_id, phone);
CREATE INDEX contacts_tenant_name_idx  ON contacts (tenant_id, lower(last_name), lower(first_name));
-- Trigram index for the CRM's global search, which must return in <200ms.
CREATE INDEX contacts_tenant_search_idx ON contacts
  USING gin ((coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' ||
              coalesce(company_name,'') || ' ' || coalesce(email,'')) gin_trgm_ops);

-- ------------------------------------------------------- consent wordings
--
-- The exact words shown to the customer, versioned.
--
-- "We had a tick box" is not evidence. "On 14 July 2026 this contact was shown
-- wording version 3, which said exactly this" is. Wordings are tenant-scoped
-- because each dealer writes their own, and they are append-only: editing the
-- wording a customer agreed to destroys the only proof of what they agreed to.
CREATE TABLE consent_wordings (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),

  version       integer NOT NULL,
  channel       consent_channel NOT NULL,
  basis         consent_basis NOT NULL,

  -- The literal text shown beside the checkbox or read down the phone.
  body          text NOT NULL,
  -- How to opt out, which PECR requires to be present at the point of
  -- collection AND in every subsequent message.
  opt_out_text  text NOT NULL,

  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),

  CONSTRAINT consent_wording_body_not_blank CHECK (length(btrim(body)) > 0),
  CONSTRAINT consent_wording_opt_out_not_blank CHECK (length(btrim(opt_out_text)) > 0)
);
CREATE UNIQUE INDEX consent_wordings_tenant_version_unique
  ON consent_wordings (tenant_id, channel, version);
CREATE INDEX consent_wordings_tenant_effective_idx
  ON consent_wordings (tenant_id, channel, effective_from DESC);

-- ------------------------------------------------------- contact_consents
--
-- THE table this module exists for. Append-only, enforced by trigger.
--
-- A grant and a withdrawal are both rows. The current state of a channel is
-- the LATEST row for that (contact, channel) — never a column someone updates.
-- That is what lets us answer "what was the position on 3 May?", which is the
-- question that actually gets asked when a complaint arrives.
CREATE TABLE contact_consents (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  contact_id      uuid NOT NULL REFERENCES contacts(id),

  channel         consent_channel NOT NULL,
  basis           consent_basis NOT NULL,
  -- false is a WITHDRAWAL, and it is a new row, not an update.
  granted         boolean NOT NULL,

  source          consent_source NOT NULL,
  -- Which words they were shown. Null only for a withdrawal, where there is no
  -- wording to record — an unsubscribe click shows nothing.
  wording_id      uuid REFERENCES consent_wordings(id),

  -- Free-text corroboration: the form URL, the call recording reference, the
  -- name of the aggregator and the basis it claimed to pass on.
  evidence        text,

  -- For an aggregator lead: who supplied it. A third party's consent generally
  -- cannot be relied on for THIS dealer's marketing, and naming the source is
  -- how that gets caught in review.
  source_detail   text,

  -- ICO good practice rather than law: consent goes stale after roughly two
  -- years of inactivity. Nullable because a soft opt-in has no fixed expiry.
  expires_at      timestamptz,

  recorded_at     timestamptz NOT NULL DEFAULT now(),
  recorded_by     uuid REFERENCES users(id),

  -- A grant must say what words were shown; a withdrawal need not.
  CONSTRAINT consent_grant_needs_wording CHECK (
    granted = false OR wording_id IS NOT NULL
  )
);
CREATE INDEX contact_consents_lookup_idx
  ON contact_consents (tenant_id, contact_id, channel, recorded_at DESC);

-- Append-only at the database level. The application could be made to respect
-- this by convention; the trigger means it cannot be made not to.
SELECT make_append_only('contact_consents');

-- ---------------------------------------------------------- suppressions
--
-- The global do-not-contact list, honoured across every channel and every
-- campaign regardless of any consent record.
--
-- Separate from `contact_consents` on purpose: a suppression must work for an
-- address that has NO contact record at all — someone forwarded a marketing
-- email to a friend, the friend clicked unsubscribe, and we must honour it
-- without first creating a contact record about a person who never asked to
-- be one.
CREATE TABLE suppressions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),

  channel       consent_channel NOT NULL,
  -- Normalised: lower-cased email, or E.164 phone. Normalisation happens in
  -- the domain layer so the same rule applies on write and on check.
  destination   text NOT NULL,

  reason        text NOT NULL,
  contact_id    uuid REFERENCES contacts(id),

  -- A suppression can be lifted when someone re-subscribes, and that must not
  -- delete the row that created it: "unsubscribed in March, re-subscribed in
  -- July" is the honest record, and a DELETE leaves only the second half.
  -- The current position is the LATEST row per destination, with `active`
  -- saying which way it points — the same shape as `contact_consents.granted`,
  -- so both read the same way and both stay auditable.
  active        boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),

  CONSTRAINT suppression_destination_not_blank CHECK (length(btrim(destination)) > 0)
);
-- NOT unique on destination: a re-subscribe appends a second row. The current
-- position is the latest row, which is what `isSuppressed` reads.
CREATE INDEX suppressions_lookup_idx
  ON suppressions (tenant_id, channel, destination, created_at DESC);

SELECT make_append_only('suppressions');

-- ------------------------------------------------------------ merges
--
-- Deduplication is routine — the same buyer enquires twice, once as
-- "dave@" and once as "David". The merge must be reversible and must never
-- silently drop a consent record, so it is recorded rather than performed
-- destructively.
CREATE TABLE contact_merges (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),

  winner_id     uuid NOT NULL REFERENCES contacts(id),
  loser_id      uuid NOT NULL REFERENCES contacts(id),
  reason        text NOT NULL,

  -- What the losing record held, so the merge can be explained or undone.
  loser_snapshot jsonb NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),

  CONSTRAINT contact_merge_distinct CHECK (winner_id <> loser_id)
);
CREATE INDEX contact_merges_tenant_winner_idx ON contact_merges (tenant_id, winner_id);

SELECT make_append_only('contact_merges');

-- --------------------------------------------------- data subject requests
--
-- Access, erasure, rectification, portability and objection, with a clock.
-- UK GDPR gives one month; the countdown is the product feature, because a
-- missed deadline is the breach.
CREATE TABLE data_subject_requests (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  contact_id     uuid REFERENCES contacts(id),

  kind           text NOT NULL,
  requested_at   timestamptz NOT NULL,
  due_at         timestamptz NOT NULL,
  completed_at   timestamptz,
  outcome        text,

  -- An erasure refused because of a legal hold is a lawful outcome, but it has
  -- to be recorded WITH its reason — "we ignored it" and "we refused it under
  -- Article 17(3)(b)" look identical in a database that stores neither.
  refused_reason text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id),

  CONSTRAINT dsr_kind_known CHECK (
    kind IN ('access', 'erasure', 'rectification', 'portability', 'objection')
  ),
  CONSTRAINT dsr_due_after_request CHECK (due_at > requested_at)
);
CREATE INDEX data_subject_requests_open_idx
  ON data_subject_requests (tenant_id, due_at) WHERE completed_at IS NULL;

-- ------------------------------------------- M7 forward references resolved
--
-- `shortlists.contact_id` and `saved_searches.contact_id` were deliberately
-- left as bare uuids in 0005 because `contacts` did not exist yet. Now it
-- does, so they get real foreign keys.
--
-- NOT VALID: the constraint applies to new rows immediately without taking an
-- ACCESS EXCLUSIVE lock to scan existing ones. Validation is a separate step
-- below, which takes only a SHARE UPDATE EXCLUSIVE lock.
ALTER TABLE shortlists
  ADD CONSTRAINT shortlists_contact_fk
  FOREIGN KEY (contact_id) REFERENCES contacts(id) NOT VALID;
ALTER TABLE shortlists VALIDATE CONSTRAINT shortlists_contact_fk;

ALTER TABLE saved_searches
  ADD CONSTRAINT saved_searches_contact_fk
  FOREIGN KEY (contact_id) REFERENCES contacts(id) NOT VALID;
ALTER TABLE saved_searches VALIDATE CONSTRAINT saved_searches_contact_fk;

-- `saved_searches.consent_id` is the link M7 wrote against but could not
-- constrain. `canSendAlert` refuses to send when it is null, so this FK is
-- what turns that check from a convention into a guarantee.
ALTER TABLE saved_searches
  ADD CONSTRAINT saved_searches_consent_fk
  FOREIGN KEY (consent_id) REFERENCES contact_consents(id) NOT VALID;
ALTER TABLE saved_searches VALIDATE CONSTRAINT saved_searches_consent_fk;

SELECT * FROM apply_tenant_policies();

COMMIT;
