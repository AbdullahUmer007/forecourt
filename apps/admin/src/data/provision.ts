/**
 * Execute a provisioning plan.
 *
 * `buildProvisioningPlan` is pure and already tested. This is the one
 * transaction that makes a dealership exist: tenant, first site, brand, the
 * nine system roles, the owner, their membership, an optional hostname, and
 * an audit row.
 *
 * Runs as `app_platform`. The grants for these writes live in migration 0025
 * and are the only reason this file can insert anything at all.
 */

import { randomBytes } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import {
  buildProvisioningPlan,
  defaultSiteTheme,
  type FcaPermission,
  type TenantInput,
  type VatSchemeDefault,
} from '@forecourt/domain';
import { acrossTenants, type Tx } from './db';

const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export interface ProvisionInput {
  name: string;
  legalName: string;
  companiesHouseNo?: string;
  vatNumber?: string;
  vatRegistered: boolean;
  fcaFrn?: string;
  fcaPermission: FcaPermission;
  arPrincipalName?: string;
  arPrincipalFrn?: string;
  vatSchemeDefault: VatSchemeDefault;
  acceptsCash: boolean;
  hvdRegistered: boolean;
  hvdNumber?: string;
  plan: string;
  ownerName: string;
  ownerEmail: string;
  siteName: string;
  hostname?: string;
  /** Skip the DNS TXT challenge. Only for hosts we control. */
  markHostVerified?: boolean;
}

export interface ProvisionResult {
  ok: true;
  tenantId: string;
  siteId: string;
  brandId: string;
  ownerUserId: string;
  ownerEmail: string;
  /** Shown once. Hashed in the database; we cannot recover it later. */
  ownerPassword: string;
  hostname: string | null;
  warnings: { field: string; message: string }[];
}

export interface ProvisionFailed {
  ok: false;
  error: string;
  issues?: { field: string; message: string }[];
}

const stockPrefix = (name: string): string => {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters.slice(0, 3) || 'RD').padEnd(3, 'X');
};

const oneTimePassword = (): string => randomBytes(18).toString('base64url');

const optional = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

const toInput = (raw: ProvisionInput): TenantInput => {
  const input: TenantInput = {
    name: raw.name.trim(),
    legalName: raw.legalName.trim(),
    vatRegistered: raw.vatRegistered,
    fcaPermission: raw.fcaPermission,
    vatSchemeDefault: raw.vatSchemeDefault,
    acceptsCash: raw.acceptsCash,
    hvdRegistered: raw.hvdRegistered,
    plan: raw.plan,
    owner: { email: raw.ownerEmail.trim().toLowerCase(), name: raw.ownerName.trim() },
    firstSite: { name: raw.siteName.trim(), timezone: 'Europe/London' },
  };
  const house = optional(raw.companiesHouseNo);
  const vat = optional(raw.vatNumber);
  const frn = optional(raw.fcaFrn);
  const arName = optional(raw.arPrincipalName);
  const arFrn = optional(raw.arPrincipalFrn);
  const hvd = optional(raw.hvdNumber);
  if (house) input.companiesHouseNo = house;
  if (vat) input.vatNumber = vat;
  if (frn) input.fcaFrn = frn;
  if (arName) input.arPrincipalName = arName;
  if (arFrn) input.arPrincipalFrn = arFrn;
  if (hvd) input.hvdNumber = hvd;
  return input;
};

export async function executeProvisioningPlan(
  raw: ProvisionInput,
  actorId: string,
): Promise<ProvisionResult | ProvisionFailed> {
  const input = toInput(raw);
  let plan;
  try {
    plan = buildProvisioningPlan(input);
  } catch (err) {
    const issues = (err as { issues?: { field: string; message: string }[] }).issues;
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'That dealership could not be created.',
      ...(issues ? { issues } : {}),
    };
  }

  const hostname = raw.hostname
    ?.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '') || null;
  if (hostname && !/^[a-z0-9.-]+$/.test(hostname)) {
    return { ok: false, error: `"${raw.hostname}" does not look like a hostname.` };
  }

  const ownerPassword = oneTimePassword();
  const passwordHash = await argonHash(ownerPassword, ARGON);
  const theme = defaultSiteTheme('classic');

  try {
    const created = await acrossTenants(async (tx) => {
      if (hostname) {
        const [taken] = await tx`
          SELECT hostname FROM domains WHERE lower(hostname) = ${hostname}`;
        if (taken) {
          throw Object.assign(new Error(
            `${hostname} is already connected to another dealership. A hostname can only ever serve one dealer.`,
          ), { code: 'HOST_TAKEN' });
        }
      }

      const [tenant] = await tx<{ id: string }[]>`
        INSERT INTO tenants (
          name, legal_name, companies_house_no, vat_number, vat_registered,
          fca_frn, fca_permission, ar_principal_name, ar_principal_frn,
          vat_scheme_default, accepts_cash, hvd_registered, hvd_number,
          plan, status
        ) VALUES (
          ${plan.tenant.name}, ${plan.tenant.legalName},
          ${plan.tenant.companiesHouseNo ?? null},
          ${plan.tenant.vatNumber ?? null},
          ${plan.tenant.vatRegistered},
          ${plan.tenant.fcaFrn ?? null},
          ${plan.tenant.fcaPermission}::fca_permission_type,
          ${plan.tenant.arPrincipalName ?? null},
          ${plan.tenant.arPrincipalFrn ?? null},
          ${plan.tenant.vatSchemeDefault}::vat_scheme_default,
          ${plan.tenant.acceptsCash},
          ${plan.tenant.hvdRegistered},
          ${plan.tenant.hvdNumber ?? null},
          ${plan.tenant.plan},
          'provisioning'::tenant_status
        ) RETURNING id`;

      if (!tenant) throw new Error('The dealership row was not created.');
      const tenantId = tenant.id;

      const [site] = await tx<{ id: string }[]>`
        INSERT INTO sites (tenant_id, name, timezone, stock_number_prefix)
        VALUES (
          ${tenantId}::uuid,
          ${plan.site.name},
          ${plan.site.timezone},
          ${stockPrefix(plan.tenant.name)}
        ) RETURNING id`;

      const [brand] = await tx<{ id: string }[]>`
        INSERT INTO brands (tenant_id, name, theme, tone_of_voice, is_default)
        VALUES (
          ${tenantId}::uuid,
          ${plan.brand.name},
          ${tx.json(JSON.parse(JSON.stringify(theme)))},
          ${plan.brand.toneOfVoice},
          true
        ) RETURNING id`;

      const roleIds = new Map<string, string>();
      for (const role of plan.roles) {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO roles (
            tenant_id, key, name, description, is_system, permissions,
            scope_all_sites, discount_limit_pence, refund_limit_pence
          ) VALUES (
            ${tenantId}::uuid,
            ${role.key}::system_role,
            ${role.name},
            ${role.description},
            true,
            ${tx.json(role.permissions)},
            ${role.scopeAllSites},
            ${role.discountLimitPence},
            ${role.refundLimitPence}
          ) RETURNING id`;
        if (!row) throw new Error(`The ${role.name} role was not created.`);
        roleIds.set(role.key, row.id);
      }

      const ownerRoleId = roleIds.get('owner');
      if (!ownerRoleId) throw new Error('The owner role was not created.');

      const ownerUserId = await upsertOwner(tx, plan.owner.email, plan.owner.name, passwordHash);

      await tx`
        INSERT INTO tenant_memberships (
          tenant_id, user_id, role_id, scope_all_sites, status, accepted_at
        ) VALUES (
          ${tenantId}::uuid, ${ownerUserId}::uuid, ${ownerRoleId}::uuid,
          true, 'active'::membership_status, now()
        )`;

      if (!brand || !site) throw new Error('The first site or brand was not created.');

      if (hostname) {
        const token = `prov-${randomBytes(8).toString('hex')}`;
        const verifiedAt = raw.markHostVerified ? new Date() : null;
        await tx`
          INSERT INTO domains (
            tenant_id, brand_id, hostname, is_primary,
            verification_token, verified_at, ssl_status
          ) VALUES (
            ${tenantId}::uuid, ${brand.id}::uuid, ${hostname}, true,
            ${token}, ${verifiedAt}, ${verifiedAt ? 'active' : 'pending'}
          )`;
      }

      await tx`
        INSERT INTO audit_events (
          tenant_id, actor_type, actor_id, resource_type, resource_id, action, diff
        ) VALUES (
          ${tenantId}::uuid, 'platform', ${actorId}::uuid,
          'tenant', ${tenantId}::uuid, 'create',
          ${tx.json({ after: { name: plan.tenant.name, owner: plan.owner.email } })}
        )`;

      return { tenantId, siteId: site.id, brandId: brand.id, ownerUserId };
    });

    return {
      ok: true,
      ...created,
      ownerEmail: plan.owner.email,
      ownerPassword,
      hostname,
      warnings: plan.warnings.map((w) => ({ field: w.field, message: w.message })),
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'HOST_TAKEN') {
      return { ok: false, error: err instanceof Error ? err.message : 'Hostname already taken.' };
    }
    if (code === '23505') {
      return {
        ok: false,
        error: 'A dealership or user with those details already exists. Check the email and trading name.',
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'The dealership could not be created. Try again.',
    };
  }
}

async function upsertOwner(
  tx: Tx,
  email: string,
  name: string,
  passwordHash: string,
): Promise<string> {
  const [existing] = await tx<{ id: string }[]>`
    SELECT id FROM users WHERE lower(email) = ${email} AND deleted_at IS NULL`;
  if (existing) {
    await tx`
      UPDATE users
         SET password_hash = ${passwordHash}, name = ${name},
             failed_login_count = 0, locked_until = NULL, updated_at = now()
       WHERE id = ${existing.id}::uuid`;
    return existing.id;
  }
  const [created] = await tx<{ id: string }[]>`
    INSERT INTO users (email, name, password_hash, status)
    VALUES (${email}, ${name}, ${passwordHash}, 'active')
    RETURNING id`;
  if (!created) throw new Error('The owner login could not be created.');
  return created.id;
}
