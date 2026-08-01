import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  SYSTEM_ROLES, ALL_PERMISSIONS, DERIVED_FROM, STEP_UP_REQUIRED,
  roleByKey, matches, holds, resolvePermissions, authorize, assertAuthorized,
  redact, hiddenFields, canSortBy, requiresMfa,
  type Principal, type Permission,
} from './permissions.js';

const principal = (over: Partial<Principal> = {}): Principal => {
  const role = roleByKey(over.roleKey ?? 'sales_executive')!;
  return {
    userId: 'u1',
    tenantId: 't1',
    roleKey: role.key,
    permissions: role.permissions,
    scope: role.scope,
    siteIds: ['s1'],
    discountLimitPence: role.discountLimitPence,
    refundLimitPence: role.refundLimitPence,
    ...over,
  };
};

describe('wildcards', () => {
  it('* covers everything', () => {
    for (const p of ALL_PERMISSIONS) expect(matches('*', p)).toBe(true);
  });

  it('resource.* covers only that resource', () => {
    expect(matches('vehicle.*', 'vehicle.cost.read')).toBe(true);
    expect(matches('vehicle.*', 'contact.read')).toBe(false);
  });

  it('does not match across a resource-name prefix', () => {
    // 'vehicle.*' must not capture a hypothetical 'vehicleaudit.read'
    expect(matches('vehicle.*', 'vehicleaudit.read')).toBe(false);
  });
});

describe('the nine system roles', () => {
  it('are all defined with valid permissions', () => {
    expect(SYSTEM_ROLES).toHaveLength(9);
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) {
        if (p === '*' || p.endsWith('.*')) continue;
        expect(ALL_PERMISSIONS, `${role.key} grants unknown permission ${p}`).toContain(p);
      }
    }
  });

  it('only Owner can delete the tenant or change billing', () => {
    for (const role of SYSTEM_ROLES) {
      const p = principal({ roleKey: role.key, permissions: role.permissions, scope: role.scope });
      const canDelete = holds(p, 'tenant.delete');
      const canBill = holds(p, 'billing.update');
      if (role.key === 'owner') {
        expect(canDelete).toBe(true);
        expect(canBill).toBe(true);
      } else {
        expect(canDelete, `${role.key} must not delete the tenant`).toBe(false);
        expect(canBill, `${role.key} must not change billing`).toBe(false);
      }
    }
  });

  it('read_only can change nothing', () => {
    const p = principal({ roleKey: 'read_only', ...roleByKey('read_only')! });
    const writes = ALL_PERMISSIONS.filter((x) => !/\.(read|export)$/.test(x));
    for (const w of writes) expect(holds(p, w), `read_only must not hold ${w}`).toBe(false);
  });

  it('prep cannot reach customer data', () => {
    const role = roleByKey('prep')!;
    const p = principal({ roleKey: 'prep', permissions: role.permissions, scope: role.scope });
    expect(holds(p, 'contact.read')).toBe(false);
    expect(holds(p, 'lead.read')).toBe(false);
    expect(holds(p, 'vehicle.update')).toBe(true);
  });

  it('accountant gets financial data but not customer PII', () => {
    const role = roleByKey('accountant')!;
    const p = principal({ roleKey: 'accountant', permissions: role.permissions, scope: role.scope });
    expect(holds(p, 'report.financial.read')).toBe(true);
    expect(holds(p, 'vehicle.cost.read')).toBe(true);
    expect(holds(p, 'contact.read')).toBe(false);
    expect(holds(p, 'contact.export')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE ACCEPTANCE CRITERION FROM THE SPEC:
// "A Sales Executive who cannot see cost prices sees no derived value that
//  reveals them (no margin, no profit column, no total-cost-based sorting)."
// ---------------------------------------------------------------------------
describe('derived-value leakage', () => {
  const salesExec = principal({ roleKey: 'sales_executive' });

  it('a Sales Executive cannot read cost', () => {
    expect(holds(salesExec, 'vehicle.cost.read')).toBe(false);
  });

  it('redaction strips cost AND everything derived from it', () => {
    const vehicle = {
      id: 'v1',
      registration: 'WN22HNL',
      retailPrice: 1_999_900,
      purchasePrice: 1_650_000,
      totalCost: 1_712_500,
      margin: 287_400,
      projectedMargin: 287_400,
      minimumPrice: 1_850_000,
      mileage: 40_470,
    };
    const visible = redact(salesExec, 'vehicle', vehicle);

    expect(visible.registration).toBe('WN22HNL');
    expect(visible.retailPrice).toBe(1_999_900);
    expect(visible.mileage).toBe(40_470);

    expect(visible).not.toHaveProperty('purchasePrice');
    expect(visible).not.toHaveProperty('totalCost');
    expect(visible).not.toHaveProperty('margin');
    expect(visible).not.toHaveProperty('projectedMargin');
    expect(visible).not.toHaveProperty('minimumPrice');

    // Belt and braces: no remaining value equals a hidden one.
    const hidden = [vehicle.purchasePrice, vehicle.totalCost, vehicle.margin, vehicle.minimumPrice];
    for (const v of Object.values(visible)) expect(hidden).not.toContain(v);
  });

  it('sorting by a hidden field is refused', () => {
    expect(canSortBy(salesExec, 'vehicle', 'margin')).toBe(false);
    expect(canSortBy(salesExec, 'vehicle', 'totalCost')).toBe(false);
    expect(canSortBy(salesExec, 'vehicle', 'purchasePrice')).toBe(false);
    expect(canSortBy(salesExec, 'vehicle', 'retailPrice')).toBe(true);
    expect(canSortBy(salesExec, 'vehicle', 'mileage')).toBe(true);
  });

  it('hiddenFields lists exactly what is withheld', () => {
    expect(hiddenFields(salesExec, 'vehicle').sort()).toEqual(
      ['margin', 'minimumPrice', 'projectedMargin', 'purchasePrice', 'totalCost'],
    );
  });

  it('granting cost.read reveals the derived values too', () => {
    const granted = principal({
      permissions: resolvePermissions(roleByKey('sales_executive')!.permissions, { grant: ['vehicle.cost.read'] }),
    });
    const visible = redact(granted, 'vehicle', { margin: 287_400, totalCost: 1_712_500 });
    expect(visible.margin).toBe(287_400);
    expect(canSortBy(granted, 'vehicle', 'margin')).toBe(true);
  });

  it('commission is hidden unless finance.commission.read is held', () => {
    const visible = redact(salesExec, 'financeAgreement', { apr: 1290, commissionAmount: 40_000 });
    expect(visible.apr).toBe(1290);
    expect(visible).not.toHaveProperty('commissionAmount');
  });

  it('no principal without the source permission can see any derived field', () => {
    for (const role of SYSTEM_ROLES) {
      const p = principal({ roleKey: role.key, permissions: role.permissions, scope: role.scope });
      for (const [path, required] of Object.entries(DERIVED_FROM)) {
        const [resource, field] = path.split('.') as [string, string];
        if (holds(p, required)) continue;
        const visible = redact(p, resource, { [field]: 'SECRET' });
        expect(visible, `${role.key} leaked ${path}`).not.toHaveProperty(field);
      }
    }
  });
});

describe('scope', () => {
  it('my_sites blocks another site', () => {
    const p = principal({ roleKey: 'prep', permissions: roleByKey('prep')!.permissions, scope: 'my_sites', siteIds: ['s1'] });
    expect(authorize(p, 'vehicle.update', { siteId: 's1' }).allowed).toBe(true);
    const d = authorize(p, 'vehicle.update', { siteId: 's2' });
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.code).toBe('OUT_OF_SCOPE');
  });

  it('own_records blocks writing another user\'s record but allows reading', () => {
    const p = principal({ roleKey: 'sales_executive' });
    expect(authorize(p, 'lead.read', { ownerId: 'someone-else' }).allowed).toBe(true);
    const d = authorize(p, 'lead.update', { ownerId: 'someone-else' });
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.code).toBe('OUT_OF_SCOPE');
    expect(authorize(p, 'lead.update', { ownerId: 'u1' }).allowed).toBe(true);
  });
});

describe('step-up authentication', () => {
  const now = new Date('2026-08-01T12:00:00Z');

  it('refuses a sensitive action without a recent re-auth', () => {
    const p = principal({ roleKey: 'manager', permissions: ['*'], scope: 'all_sites' });
    const d = authorize(p, 'contact.export', { now });
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.code).toBe('STEP_UP_REQUIRED');
  });

  it('allows it within the five-minute window', () => {
    const p = principal({
      permissions: ['*'], scope: 'all_sites',
      stepUpSatisfiedAt: new Date(now.getTime() - 60_000),
    });
    expect(authorize(p, 'contact.export', { now }).allowed).toBe(true);
  });

  it('refuses again once the window has expired', () => {
    const p = principal({
      permissions: ['*'], scope: 'all_sites',
      stepUpSatisfiedAt: new Date(now.getTime() - 6 * 60_000),
    });
    expect(authorize(p, 'contact.export', { now }).allowed).toBe(false);
  });

  it('every step-up action is a real permission', () => {
    for (const p of STEP_UP_REQUIRED) expect(ALL_PERMISSIONS).toContain(p);
  });
});

describe('value thresholds', () => {
  it('a discount over the limit needs approval', () => {
    const p = principal({ roleKey: 'sales_executive' }); // £250 limit
    expect(authorize(p, 'deal.discount.approve', { amountPence: 20_000 }).allowed).toBe(false); // no permission at all
    const mgr = principal({
      roleKey: 'manager', permissions: roleByKey('manager')!.permissions, scope: 'all_sites',
      discountLimitPence: 150_000,
    });
    expect(authorize(mgr, 'deal.discount.approve', { amountPence: 100_000 }).allowed).toBe(true);
    const over = authorize(mgr, 'deal.discount.approve', { amountPence: 200_000 });
    expect(over.allowed).toBe(false);
    expect(over.allowed === false && over.code).toBe('OVER_LIMIT');
  });
});

describe('override resolution', () => {
  it('revoking a specific permission punctures a wildcard that covered it', () => {
    const resolved = resolvePermissions(['vehicle.*'], { revoke: ['vehicle.delete'] });
    const p = principal({ permissions: resolved });
    expect(holds(p, 'vehicle.read')).toBe(true);
    expect(holds(p, 'vehicle.cost.read')).toBe(true);
    expect(holds(p, 'vehicle.delete')).toBe(false);
  });

  it('revoking from a full wildcard leaves everything else intact', () => {
    const resolved = resolvePermissions(['*'], { revoke: ['tenant.delete'] });
    const p = principal({ permissions: resolved });
    expect(holds(p, 'tenant.delete')).toBe(false);
    expect(holds(p, 'billing.update')).toBe(true);
    expect(holds(p, 'vehicle.read')).toBe(true);
  });

  it('a revocation is never silently ignored, for any role and any permission', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SYSTEM_ROLES.map((r) => r.key)),
        fc.constantFrom(...ALL_PERMISSIONS),
        (roleKey, target) => {
          const role = roleByKey(roleKey)!;
          const resolved = resolvePermissions(role.permissions, { revoke: [target] });
          const p = principal({ permissions: resolved });
          expect(holds(p, target), `${roleKey} still holds revoked ${target}`).toBe(false);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('a grant always takes effect', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_PERMISSIONS), (target) => {
        const p = principal({ permissions: resolvePermissions(roleByKey('prep')!.permissions, { grant: [target] }) });
        expect(holds(p, target)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe('MFA enforcement', () => {
  it('is required for Owner and anyone holding finance or export permissions', () => {
    expect(requiresMfa(['*'])).toBe(true);
    expect(requiresMfa(roleByKey('business_manager')!.permissions)).toBe(true);
    expect(requiresMfa(roleByKey('prep')!.permissions)).toBe(false);
    expect(requiresMfa(roleByKey('sales_executive')!.permissions)).toBe(false);
  });
});

describe('assertAuthorized', () => {
  it('throws with a code and the permission attached', () => {
    const p = principal({ roleKey: 'prep', permissions: roleByKey('prep')!.permissions, scope: 'my_sites' });
    try {
      assertAuthorized(p, 'contact.export');
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as Error & { code: string; permission: string };
      expect(e.code).toBe('NO_PERMISSION');
      expect(e.permission).toBe('contact.export');
    }
  });
});
