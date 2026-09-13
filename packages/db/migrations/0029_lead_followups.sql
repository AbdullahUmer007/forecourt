BEGIN;
ALTER TABLE leads ADD COLUMN follow_up_at timestamptz,
  ADD COLUMN follow_up_note text,
  ADD COLUMN follow_up_version integer NOT NULL DEFAULT 0;
ALTER TABLE leads ADD CONSTRAINT lead_follow_up_pair CHECK (
  (follow_up_at IS NULL AND follow_up_note IS NULL) OR
  (follow_up_at IS NOT NULL AND follow_up_note IS NOT NULL AND length(trim(follow_up_note)) BETWEEN 1 AND 2000)
);
CREATE INDEX leads_follow_up_idx ON leads (tenant_id, follow_up_at)
  WHERE closed_at IS NULL AND follow_up_at IS NOT NULL;
COMMIT;
