# Multi-tenancy checklist

A leak between two dealers is the one bug that ends the company. Treat this as the most important page in the repository.

## The model

Shared database, shared schema, `tenant_id` on every tenant-owned row, **four independent layers of isolation**. Any one layer failing must not cause a leak.

---

## Layer 1 — Request context

Auth middleware resolves session → user → tenant memberships → active tenant + site scope, and sets it once per request into AsyncLocalStorage.

```ts
type TenantContext = {
  tenantId: string
  userId: string
  siteIds: string[]
  scopeAllSites: boolean
  permissions: Set<Permission>
}
```

- There is **no code path** that reaches the database without a tenant context. A runtime assertion throws if one is missing, and a lint rule flags direct client usage outside the repository layer.
- Platform/admin jobs use an explicitly-named `PlatformContext`, never a "null tenant".

## Layer 2 — Database session variables

Every connection checkout:

```sql
SET LOCAL app.tenant_id       = '<uuid>';
SET LOCAL app.user_id         = '<uuid>';
SET LOCAL app.site_ids        = '<uuid,uuid>';
SET LOCAL app.scope_all_sites = 'true'|'false';
SET LOCAL ROLE app_user;
```

- `app_user` is **not** a superuser and **cannot** bypass RLS.
- Migrations use `app_migrator`. Platform jobs use `app_platform`. Both are separately named and separately audited.
- `SET LOCAL` (not `SET`) so it is scoped to the transaction and cannot leak across a pooled connection.

## Layer 3 — Row-level security

Every tenant table, without exception:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE  ROW LEVEL SECURITY;   -- without FORCE, the owner bypasses the policy

CREATE POLICY tenant_isolation ON <table>
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Site scoping, where the resource is site-bound:

```sql
CREATE POLICY site_scope ON <table>
  USING (
    current_setting('app.scope_all_sites', true)::boolean
    OR site_id = ANY (string_to_array(current_setting('app.site_ids', true), ',')::uuid[])
  );
```

**`FORCE ROW LEVEL SECURITY` is not optional.** Without it, the table owner silently bypasses every policy you just wrote.

## Layer 4 — Repository guard

A thin repository layer that injects `tenant_id` on every write and asserts its presence on every read. Belt and braces: RLS catches what the code misses; the code catches what a policy migration forgot.

---

## Adding a new table — the checklist

- [ ] `tenant_id uuid not null references tenants(id)`
- [ ] `site_id uuid references sites(id)` if the record is operational
- [ ] `id uuid primary key default uuid_generate_v7()`
- [ ] `created_at`, `updated_at`, `created_by`, `updated_by`
- [ ] `deleted_at` **only** if this is not a financial, invoice, stock-book or evidence table
- [ ] Money columns as `bigint` + a `currency` column
- [ ] `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`
- [ ] `tenant_isolation` policy created
- [ ] `site_scope` policy created if site-bound
- [ ] Tenant-first composite indexes on every query path used
- [ ] Unique constraints scoped by tenant: `UNIQUE (tenant_id, registration)`, never `UNIQUE (registration)`
- [ ] Foreign keys point only at rows in the same tenant (add a composite FK on `(tenant_id, id)` where the risk is real)
- [ ] **Registered in the cross-tenant leak test suite**
- [ ] Added to the tenant export routine (data portability is a product promise)
- [ ] Retention rule defined — how long, and what happens at the end
- [ ] Audit coverage confirmed

---

## The cross-tenant leak test suite

The most important test in the repository. It runs on **every PR** and is a **blocking gate**.

For every table and every API surface:

1. Seed tenant A and tenant B with identical-looking data
2. Authenticate as a user of tenant A
3. Attempt, for every one of tenant B's records:
   - direct read by ID
   - appearance in any list endpoint
   - appearance in global search
   - inclusion in any export
   - inclusion in any feed payload
   - reachability via any public route or custom domain
   - reachability via the public REST API with tenant A's key
   - update by ID
   - delete by ID
   - use as a foreign key from a tenant A record
4. **Fail the build on any leak**
5. **Fail the build on any new table that has no policy and no test**

```ts
// The gate that catches the table someone forgot
test('every tenant table has RLS enabled, forced, and a policy', async () => {
  const tables = await db.execute(sql`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = c.relname AND column_name = 'tenant_id')
  `)
  for (const t of tables) {
    expect(t.relrowsecurity, `${t.relname}: RLS not enabled`).toBe(true)
    expect(t.relforcerowsecurity, `${t.relname}: RLS not FORCED`).toBe(true)
    expect(await policiesFor(t.relname)).not.toHaveLength(0)
  }
})
```

---

## Public site tenant resolution

Incoming `Host` header → `domains` table → brand → tenant. Cached at the edge.

- A domain must be **verified** (DNS TXT challenge) before it resolves. An unverified domain 404s.
- An unknown host returns a branded 404 — **never** a default tenant, never the first tenant, never a redirect to another dealer's site.
- The public renderer connects as a **read-only** role with the same RLS policies, scoped to published records only.
- Cache keys always include the tenant. A cache key without a tenant is a leak waiting to happen.

---

## Support impersonation

The other way tenant data leaks: us.

- Time-limited (default 60 minutes, hard maximum 8 hours)
- Reason required, free text, recorded
- Explicitly consented per tenant in their settings; a tenant can disable it entirely
- A persistent, unmissable banner in the UI while active
- Fully audited: who, which tenant, when, why, and every action taken
- **Finance commission records and full payment details are excluded** unless a second approver signs off
- Never used to perform a write on the tenant's behalf without their explicit, recorded request

---

## Things that have leaked in other products, and how we prevent each

| Leak vector | Prevention |
|---|---|
| A cache key without a tenant | Cache key builder takes `TenantContext` as a required argument |
| A background job that iterates "all records" | Platform jobs use `PlatformContext` and must declare their scope explicitly; a job with no scope declaration fails to register |
| A search index shared across tenants | Index namespace includes the tenant ID; the query builder cannot omit it |
| An object-storage URL that is guessable | Content-hashed keys under a tenant prefix, served via signed URLs with short expiry |
| An error message echoing another tenant's data | Structured logging with automatic PII redaction; error payloads never include raw rows |
| A report or export that forgot its scope | Exports go through the same repository layer; the leak suite covers export endpoints |
| A webhook delivered to the wrong tenant's endpoint | Webhook subscriptions are tenant-scoped and the payload is built inside the tenant context |
| An email template rendered with the wrong tenant's branding | Rendering takes `TenantContext`; there is no global "current brand" |
