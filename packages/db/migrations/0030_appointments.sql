BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_identity ON contacts (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS sites_tenant_identity ON sites (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS leads_tenant_identity ON leads (tenant_id, id);
CREATE TABLE appointments (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 site_id uuid NOT NULL,
 contact_id uuid NOT NULL,
 lead_id uuid,
 assigned_to uuid NOT NULL REFERENCES users(id),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('viewing', 'test_drive', 'collection', 'meeting')),
 status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
 notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
 outcome text,
 version integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id),
 FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id),
 FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id),
 FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id),
 CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '8 hours'),
 CHECK (status = 'scheduled' OR (outcome IS NOT NULL AND length(trim(outcome)) BETWEEN 1 AND 2000))
);
CREATE INDEX appointments_diary ON appointments (tenant_id, starts_at, site_id);
CREATE INDEX appointments_staff ON appointments (tenant_id, assigned_to, starts_at, ends_at) WHERE status = 'scheduled';
SELECT * FROM apply_tenant_policies();
COMMIT;
