import { describe, it, expect } from 'vitest';
import {
  validateTenantInput, canProvision, buildProvisioningPlan,
  GO_LIVE_CHECKLIST, outstandingChecklistItems, canTenantGoLive, goLiveProgress,
  type TenantInput,
} from './provisioning.js';
import { SYSTEM_ROLES } from './permissions.js';

/**
 * A fixture override may explicitly CLEAR a field — `{ fcaFrn: undefined }` is
 * how these tests say "a regulated firm that did not give us an FRN", which is
 * the case the validator exists to catch.
 *
 * Under `exactOptionalPropertyTypes` that is not the same as `Partial<T>`:
 * an optional `fcaFrn?: string` accepts the key being absent, not the key
 * being present and undefined. So the override is applied by DELETING the key
 * rather than spreading undefined over it, which is also what the test means.
 */
type Overrides<T> = { [K in keyof T]?: T[K] | undefined };

const applyOverrides = <T extends object>(base: T, over: Overrides<T>): T => {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as T;
};

/** Kennington Car Sales — our real test dealer. Public data. */
const kennington = (over: Overrides<TenantInput> = {}): TenantInput =>
  applyOverrides<TenantInput>({
    name: 'Kennington Car Sales',
    legalName: 'Kennington Car Sales Limited',
    companiesHouseNo: '08384467',
    vatRegistered: true,
    vatNumber: 'GB000000000',
    fcaFrn: '993469',
    fcaPermission: 'limited',
    vatSchemeDefault: 'margin',
    acceptsCash: false,
    hvdRegistered: false,
    tradeBodies: ['AA Approved Dealer'],
    plan: 'pro',
    owner: { email: 'owner@kenningtoncarsales.co.uk', name: 'Dealer Principal' },
    firstSite: { name: 'Bletchley' },
  }, over);

describe('compliance profile validation', () => {
  it('accepts a well-formed limited-permission dealer', () => {
    const issues = validateTenantInput(kennington());
    expect(canProvision(issues)).toBe(true);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refuses a regulated firm with no FRN', () => {
    const issues = validateTenantInput(kennington({ fcaFrn: undefined }));
    expect(canProvision(issues)).toBe(false);
    expect(issues.find((i) => i.field === 'fcaFrn')?.message).toMatch(/Firm Reference Number/);
  });

  it('refuses an Appointed Representative with no principal', () => {
    const issues = validateTenantInput(kennington({ fcaPermission: 'appointed_rep' }));
    expect(canProvision(issues)).toBe(false);
    expect(issues.find((i) => i.field === 'arPrincipal')?.message).toMatch(/principal firm/);
  });

  it('accepts an Appointed Representative that names its principal', () => {
    const issues = validateTenantInput(kennington({
      fcaPermission: 'appointed_rep',
      arPrincipalName: 'Some Network Ltd',
      arPrincipalFrn: '123456',
    }));
    expect(canProvision(issues)).toBe(true);
  });

  it('warns — but does not block — when no FCA permission is recorded', () => {
    const issues = validateTenantInput(kennington({ fcaPermission: 'none', fcaFrn: undefined }));
    expect(canProvision(issues)).toBe(true);
    expect(issues.find((i) => i.field === 'fcaPermission')?.severity).toBe('warning');
  });

  it('refuses the qualifying scheme for a non-VAT-registered dealer', () => {
    const issues = validateTenantInput(kennington({
      vatRegistered: false, vatNumber: undefined, vatSchemeDefault: 'qualifying',
    }));
    expect(canProvision(issues)).toBe(false);
  });

  it('warns loudly when a dealer accepts cash without HVD registration', () => {
    const issues = validateTenantInput(kennington({ acceptsCash: true, hvdRegistered: false }));
    const warning = issues.find((i) => i.field === 'acceptsCash');
    expect(warning?.severity).toBe('warning');
    // Registration cannot be retrospective — the wording must say so.
    expect(warning?.message).toMatch(/BEFORE|retrospectiv/i);
    expect(warning?.source).toContain('gov.uk');
  });

  it('refuses HVD registration with no registration number', () => {
    const issues = validateTenantInput(kennington({ acceptsCash: true, hvdRegistered: true }));
    expect(canProvision(issues)).toBe(false);
  });

  it('every error carries a field and a message', () => {
    const issues = validateTenantInput(
      kennington({ name: '', legalName: '', fcaFrn: undefined }));
    for (const i of issues) {
      expect(i.field).toBeTruthy();
      expect(i.message.length).toBeGreaterThan(10);
    }
  });
});

describe('the provisioning plan', () => {
  it('seeds all nine system roles, per tenant', () => {
    const plan = buildProvisioningPlan(kennington());
    expect(plan.roles).toHaveLength(9);
    expect(plan.roles.map((r) => r.key).sort()).toEqual(SYSTEM_ROLES.map((r) => r.key).sort());
    for (const r of plan.roles) expect(r.isSystem).toBe(true);
  });

  it('gives the Owner role everything and no one else tenant deletion', () => {
    const plan = buildProvisioningPlan(kennington());
    const owner = plan.roles.find((r) => r.key === 'owner')!;
    expect(owner.permissions).toContain('*');
    for (const r of plan.roles.filter((x) => x.key !== 'owner')) {
      expect(r.permissions).not.toContain('*');
      expect(r.permissions).not.toContain('tenant.delete');
    }
  });

  it('seeds the document templates the compliance modules depend on', () => {
    const plan = buildProvisioningPlan(kennington());
    for (const required of ['initial_disclosure', 'commission_disclosure', 'cancellation_notice', 'consent_wording']) {
      expect(plan.documentTemplates).toContain(required);
    }
  });

  it('defaults the site timezone to Europe/London', () => {
    expect(buildProvisioningPlan(kennington()).site.timezone).toBe('Europe/London');
  });

  it('starts in provisioning, never live', () => {
    expect(buildProvisioningPlan(kennington()).tenant.status).toBe('provisioning');
  });

  it('carries warnings through rather than swallowing them', () => {
    const plan = buildProvisioningPlan(kennington({ acceptsCash: true }));
    expect(plan.warnings.some((w) => w.field === 'acceptsCash')).toBe(true);
  });

  it('throws with the issues attached when validation fails', () => {
    try {
      buildProvisioningPlan(kennington({ fcaFrn: undefined }));
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as Error & { code: string; issues: unknown[] };
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('the go-live checklist', () => {
  const required = GO_LIVE_CHECKLIST.filter((i) => i.required).map((i) => i.key);

  it('will not let a tenant go live with no stock', () => {
    const satisfied = required.filter((k) => k !== 'stock_imported');
    expect(canTenantGoLive(satisfied)).toBe(false);
    expect(outstandingChecklistItems(satisfied).map((i) => i.key)).toEqual(['stock_imported']);
  });

  it('will not let a tenant go live with an incomplete VAT stock book', () => {
    expect(canTenantGoLive(required.filter((k) => k !== 'stock_book_complete'))).toBe(false);
  });

  it('will not let a tenant go live with vehicles that have no photographs', () => {
    expect(canTenantGoLive(required.filter((k) => k !== 'hero_images'))).toBe(false);
  });

  it('goes live when every required item is satisfied', () => {
    expect(canTenantGoLive(required)).toBe(true);
    expect(goLiveProgress(required)).toBe(100);
  });

  it('optional items do not block go-live', () => {
    expect(canTenantGoLive(required)).toBe(true);   // accounting/finance/users not included
  });

  it('reports progress as a percentage of required items only', () => {
    expect(goLiveProgress([])).toBe(0);
    const half = required.slice(0, Math.floor(required.length / 2));
    expect(goLiveProgress(half)).toBeGreaterThan(0);
    expect(goLiveProgress(half)).toBeLessThan(100);
  });
});
