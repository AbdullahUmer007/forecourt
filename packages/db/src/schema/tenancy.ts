/**
 * M2 — Tenancy & identity schema.
 *
 * Conventions (CLAUDE.md, forecourt-feature skill):
 *  - `tenant_id` on every tenant-owned table; `site_id` where operational
 *  - uuid v7 primary keys (time-sortable)
 *  - created_at / updated_at / created_by / updated_by on everything
 *  - money as bigint minor units + explicit currency (none in this module)
 *  - timestamptz, stored UTC, rendered in the tenant's timezone
 *  - soft delete via deleted_at, EXCEPT on audit (append-only)
 *  - unique constraints scoped by tenant, never global
 */

import {
  pgTable, uuid, text, boolean, timestamp, jsonb, integer,
  index, uniqueIndex, pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// uuid v7 — see migrations/0001_tenancy.sql for the SQL function
const id = () => uuid('id').primaryKey().default(sql`uuid_generate_v7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- enums

export const fcaPermissionType = pgEnum('fca_permission_type', [
  'limited',            // CONC 2.5 secondary credit broker — most independents
  'full',
  'appointed_rep',      // operating under a principal's permission, SUP 12
  'none',               // does not introduce finance
]);

export const vatSchemeDefault = pgEnum('vat_scheme_default', ['margin', 'qualifying', 'mixed']);

export const tenantStatus = pgEnum('tenant_status', [
  'provisioning', 'trial', 'live', 'past_due', 'suspended', 'cancelled',
]);

export const membershipStatus = pgEnum('membership_status', ['invited', 'active', 'suspended', 'removed']);

export const systemRole = pgEnum('system_role', [
  'owner', 'manager', 'sales_executive', 'business_manager',
  'buyer', 'prep', 'marketing', 'accountant', 'read_only',
]);

// ---------------------------------------------------------------- tenants

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),                       // trading name
  legalName: text('legal_name').notNull(),
  companiesHouseNo: text('companies_house_no'),
  vatNumber: text('vat_number'),
  vatRegistered: boolean('vat_registered').notNull().default(false),

  // Compliance profile — set once at onboarding, drives behaviour everywhere.
  fcaFrn: text('fca_frn'),
  fcaPermission: fcaPermissionType('fca_permission').notNull().default('none'),
  arPrincipalName: text('ar_principal_name'),
  arPrincipalFrn: text('ar_principal_frn'),
  vatSchemeDefault: vatSchemeDefault('vat_scheme_default').notNull().default('margin'),

  // AML. Threshold itself lives in compliance_rules, never here.
  acceptsCash: boolean('accepts_cash').notNull().default(false),
  hvdRegistered: boolean('hvd_registered').notNull().default(false),
  hvdNumber: text('hvd_number'),

  tradeBodies: text('trade_bodies').array().notNull().default(sql`'{}'`),
  dataProtectionContact: text('data_protection_contact'),

  plan: text('plan').notNull().default('pro'),
  status: tenantStatus('status').notNull().default('provisioning'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  // An AR must name its principal. Enforced again as a CHECK in the migration.
  statusIdx: index('tenants_status_idx').on(t.status),
  frnIdx: index('tenants_fca_frn_idx').on(t.fcaFrn),
}));

// ---------------------------------------------------------------- sites

export const sites = pgTable('sites', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  address: jsonb('address').notNull().default(sql`'{}'::jsonb`),
  lat: text('lat'),
  lng: text('lng'),
  phone: text('phone'),
  email: text('email'),
  openingHours: jsonb('opening_hours').notNull().default(sql`'{}'::jsonb`),
  timezone: text('timezone').notNull().default('Europe/London'),
  stockNumberPrefix: text('stock_number_prefix'),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  tenantIdx: index('sites_tenant_idx').on(t.tenantId, t.isActive),
  nameUnique: uniqueIndex('sites_tenant_name_unique').on(t.tenantId, t.name),
}));

// ---------------------------------------------------------------- brands

export const brands = pgTable('brands', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  logoLightKey: text('logo_light_key'),
  logoDarkKey: text('logo_dark_key'),
  // Only the constrained, validated token set is dealer-editable.
  // See packages/tokens/tokens.md — a colour that fails AA cannot be saved.
  theme: jsonb('theme').notNull().default(sql`'{}'::jsonb`),
  toneOfVoice: text('tone_of_voice').notNull().default('straight_talking'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  tenantIdx: index('brands_tenant_idx').on(t.tenantId),
}));

export const domains = pgTable('domains', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  brandId: uuid('brand_id').notNull().references(() => brands.id),
  hostname: text('hostname').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  verificationToken: text('verification_token').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  sslStatus: text('ssl_status').notNull().default('pending'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  // Global uniqueness is correct here and is the ONE deliberate exception to
  // tenant-scoped uniqueness: a hostname can only ever resolve to one tenant.
  // An unverified or unknown host must 404, never fall through to a default.
  hostnameUnique: uniqueIndex('domains_hostname_unique').on(t.hostname),
  tenantIdx: index('domains_tenant_idx').on(t.tenantId),
}));

// ---------------------------------------------------------------- users

/**
 * Users are GLOBAL, not tenant-scoped — one person may work for two dealers,
 * and an accountant may serve several. The tenant boundary is the membership,
 * not the user. This table therefore has NO tenant_id and NO RLS policy; it is
 * reachable only through tenant_memberships.
 */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash'),        // argon2id; null when SSO/passkey-only
  mfaSecret: text('mfa_secret'),              // encrypted at rest
  mfaEnrolledAt: timestamp('mfa_enrolled_at', { withTimezone: true }),
  passkeys: jsonb('passkeys').notNull().default(sql`'[]'::jsonb`),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  emailUnique: uniqueIndex('users_email_unique').on(t.email),
}));

// ---------------------------------------------------------------- roles

/**
 * A tenant may customise the nine defaults or add its own. `isSystem` rows are
 * seeded per tenant at provisioning so a tenant can edit them without affecting
 * anyone else.
 */
export const roles = pgTable('roles', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  key: systemRole('key'),                     // null for a bespoke role
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  permissions: jsonb('permissions').notNull().default(sql`'[]'::jsonb`),
  scopeAllSites: boolean('scope_all_sites').notNull().default(false),
  // Value thresholds above which an approval workflow triggers.
  // Money as integer minor units — pence.
  discountLimitPence: integer('discount_limit_pence'),
  refundLimitPence: integer('refund_limit_pence'),
  priceChangeLimitPence: integer('price_change_limit_pence'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  tenantNameUnique: uniqueIndex('roles_tenant_name_unique').on(t.tenantId, t.name),
  tenantIdx: index('roles_tenant_idx').on(t.tenantId),
}));

export const tenantMemberships = pgTable('tenant_memberships', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  // Per-member grants and revocations layered over the role.
  permissionOverrides: jsonb('permission_overrides').notNull().default(sql`'{"grant":[],"revoke":[]}'::jsonb`),
  scopeAllSites: boolean('scope_all_sites').notNull().default(false),
  jobTitle: text('job_title'),
  status: membershipStatus('status').notNull().default('invited'),
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  tenantUserUnique: uniqueIndex('memberships_tenant_user_unique').on(t.tenantId, t.userId),
  tenantIdx: index('memberships_tenant_idx').on(t.tenantId, t.status),
  userIdx: index('memberships_user_idx').on(t.userId),
}));

export const userSites = pgTable('user_sites', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  membershipId: uuid('membership_id').notNull().references(() => tenantMemberships.id),
  siteId: uuid('site_id').notNull().references(() => sites.id),
  createdAt: createdAt(),
}, (t) => ({
  unique: uniqueIndex('user_sites_unique').on(t.membershipId, t.siteId),
  tenantIdx: index('user_sites_tenant_idx').on(t.tenantId),
}));

export const invitations = pgTable('invitations', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  siteIds: uuid('site_ids').array().notNull().default(sql`'{}'`),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({
  tenantEmailIdx: index('invitations_tenant_email_idx').on(t.tenantId, t.email),
  tokenIdx: uniqueIndex('invitations_token_unique').on(t.tokenHash),
}));

// ---------------------------------------------------------------- sessions & keys

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),   // active workspace
  tokenHash: text('token_hash').notNull(),
  deviceName: text('device_name'),
  userAgent: text('user_agent'),
  ip: text('ip'),
  trustedDevice: boolean('trusted_device').notNull().default(false),
  mfaSatisfiedAt: timestamp('mfa_satisfied_at', { withTimezone: true }),
  // Step-up auth for contact export, bank detail changes, commission edits.
  stepUpSatisfiedAt: timestamp('step_up_satisfied_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({
  tokenUnique: uniqueIndex('sessions_token_unique').on(t.tokenHash),
  userIdx: index('sessions_user_idx').on(t.userId),
}));

export const apiKeys = pgTable('api_keys', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),        // shown in the UI, e.g. fc_live_a1b2
  scopes: text('scopes').array().notNull().default(sql`'{}'`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({
  hashUnique: uniqueIndex('api_keys_hash_unique').on(t.keyHash),
  tenantIdx: index('api_keys_tenant_idx').on(t.tenantId),
}));

// ---------------------------------------------------------------- audit

/**
 * Append-only. Retained 7 years minimum. Partitioned monthly in the migration.
 * The append_only trigger rejects UPDATE and DELETE.
 */
export const auditEvents = pgTable('audit_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  siteId: uuid('site_id'),
  actorType: text('actor_type').notNull(),        // user | system | integration | platform
  actorId: uuid('actor_id'),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id'),
  action: text('action').notNull(),               // create | update | delete | denied | login | ...
  diff: jsonb('diff'),                            // before/after for changed fields only
  ip: text('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantTimeIdx: index('audit_tenant_time_idx').on(t.tenantId, t.occurredAt),
  resourceIdx: index('audit_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  actorIdx: index('audit_actor_idx').on(t.tenantId, t.actorId),
}));

/**
 * Platform-level, NOT tenant-scoped. Every regulatory threshold, rate, date and
 * window lives here as versioned, source-linked data. There is deliberately no
 * tenant_id: the law is the same for everyone, and a tenant must not be able to
 * edit it.
 */
export const complianceRules = pgTable('compliance_rules', {
  id: id(),
  key: text('key').notNull(),                     // e.g. 'vat.margin_fraction'
  version: integer('version').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  parameters: jsonb('parameters').notNull(),
  sourceUrl: text('source_url').notNull(),
  notes: text('notes'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => ({
  keyVersionUnique: uniqueIndex('compliance_rules_key_version_unique').on(t.key, t.version),
  keyEffectiveIdx: index('compliance_rules_key_effective_idx').on(t.key, t.effectiveFrom),
}));
