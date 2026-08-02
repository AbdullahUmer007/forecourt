-- =====================================================================
-- M5 — Media pipeline
--
-- Expand-only. Rollback: 0004_media.down.sql
-- Depends on 0002_vehicles.sql.
-- =====================================================================

BEGIN;

CREATE TYPE media_kind AS ENUM ('photo', 'video', 'spin', 'document');

CREATE TYPE shot_kind AS ENUM (
  'front_three_quarter', 'rear_three_quarter', 'front', 'rear',
  'nearside', 'offside', 'interior_front', 'interior_rear',
  'dashboard', 'odometer', 'boot', 'engine_bay',
  'wheels', 'keys', 'service_book', 'v5c', 'damage', 'other'
);

CREATE TYPE media_status AS ENUM ('uploading', 'processing', 'ready', 'failed', 'quarantined');

-- ---------------------------------------------------------------- media
CREATE TABLE vehicle_media (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  site_id                uuid REFERENCES sites(id),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),

  kind                   media_kind NOT NULL DEFAULT 'photo',
  shot                   shot_kind NOT NULL DEFAULT 'other',
  status                 media_status NOT NULL DEFAULT 'uploading',

  -- Tenant-prefixed and content-hashed. A guessable storage URL is a
  -- cross-tenant leak that bypasses the database entirely, where no RLS
  -- policy can help — see packages/domain/src/media.ts.
  storage_key            text NOT NULL,
  content_hash           text,
  variants               jsonb NOT NULL DEFAULT '[]'::jsonb,

  original_filename      text,
  mime_type              text,
  bytes                  bigint,
  width                  integer,
  height                 integer,

  position               integer NOT NULL DEFAULT 0,
  is_hero                boolean NOT NULL DEFAULT false,
  published              boolean NOT NULL DEFAULT false,
  caption                text,
  alt_text               text,
  tags                   text[] NOT NULL DEFAULT '{}',

  -- A damage photograph shown to a buyer is a Consumer Rights Act defence.
  -- Once shown it must never be silently replaced.
  is_disclosure_evidence boolean NOT NULL DEFAULT false,
  shown_to_buyer_at      timestamptz,

  -- Processing provenance. exif_stripped is a PRIVACY control: a phone photo
  -- carries GPS, which discloses where stock is kept and — for a part-exchange
  -- appraisal — usually a customer's home address.
  exif_stripped          boolean NOT NULL DEFAULT false,
  plate_blurred          boolean NOT NULL DEFAULT false,
  background_replaced    boolean NOT NULL DEFAULT false,
  watermarked            boolean NOT NULL DEFAULT false,
  processed_at           timestamptz,
  processing_error       text,

  external_url           text,          -- video / spin providers
  duration_seconds       integer,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES users(id),
  updated_by             uuid REFERENCES users(id),
  deleted_at             timestamptz,

  CONSTRAINT vehicle_media_bytes_non_negative CHECK (coalesce(bytes, 0) >= 0),
  CONSTRAINT vehicle_media_dimensions_non_negative CHECK (
    coalesce(width, 0) >= 0 AND coalesce(height, 0) >= 0
  ),
  -- Nothing may be published until it has been processed, because publishing
  -- an unprocessed image publishes its EXIF GPS with it.
  CONSTRAINT vehicle_media_published_requires_ready CHECK (
    NOT published OR (status = 'ready' AND exif_stripped)
  ),
  -- Evidence that has been shown to a buyer cannot be soft-deleted.
  CONSTRAINT vehicle_media_evidence_not_deletable CHECK (
    NOT (is_disclosure_evidence AND shown_to_buyer_at IS NOT NULL AND deleted_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX vehicle_media_storage_key_unique ON vehicle_media (tenant_id, storage_key);
CREATE INDEX vm_tenant_vehicle_idx ON vehicle_media (tenant_id, vehicle_id, position) WHERE deleted_at IS NULL;
CREATE INDEX vm_tenant_published_idx ON vehicle_media (tenant_id, vehicle_id) WHERE published AND deleted_at IS NULL;
CREATE INDEX vm_tenant_status_idx ON vehicle_media (tenant_id, status) WHERE status IN ('uploading','processing','failed');
-- At most one hero per vehicle, enforced by the database rather than by hope.
CREATE UNIQUE INDEX vm_one_hero_per_vehicle ON vehicle_media (tenant_id, vehicle_id)
  WHERE is_hero AND deleted_at IS NULL;

-- ---------------------------------------------------------------- processing jobs
CREATE TABLE media_processing_jobs (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  media_id       uuid NOT NULL REFERENCES vehicle_media(id) ON DELETE CASCADE,
  steps          text[] NOT NULL,
  current_step   text,
  attempts       integer NOT NULL DEFAULT 0,
  max_attempts   integer NOT NULL DEFAULT 3,
  idempotency_key text NOT NULL,
  status         text NOT NULL DEFAULT 'queued',
  error          text,
  queued_at      timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  CONSTRAINT mpj_attempts_non_negative CHECK (attempts >= 0 AND max_attempts > 0)
);
CREATE UNIQUE INDEX mpj_idempotency_unique ON media_processing_jobs (tenant_id, idempotency_key);
CREATE INDEX mpj_tenant_status_idx ON media_processing_jobs (tenant_id, status, queued_at);

-- ---------------------------------------------------------------------
-- Keep vehicles.published_photo_count accurate.
--
-- M3's go-live gate reads this column. Maintaining it in application code
-- would mean a missed update silently unblocks or blocks a vehicle, so the
-- database owns it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_published_photo_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_vehicle uuid := coalesce(NEW.vehicle_id, OLD.vehicle_id);
  target_tenant  uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
BEGIN
  UPDATE vehicles v
     SET published_photo_count = (
           SELECT count(*) FROM vehicle_media m
            WHERE m.vehicle_id = target_vehicle
              AND m.tenant_id = target_tenant
              AND m.published
              AND m.kind = 'photo'
              AND m.deleted_at IS NULL)
   WHERE v.id = target_vehicle AND v.tenant_id = target_tenant;
  RETURN NULL;
END $$;

CREATE TRIGGER vehicle_media_count_sync
  AFTER INSERT OR UPDATE OF published, deleted_at, kind OR DELETE ON vehicle_media
  FOR EACH ROW EXECUTE FUNCTION sync_published_photo_count();

SELECT * FROM apply_tenant_policies();

COMMIT;
