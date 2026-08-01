/**
 * M2 — the permission model.
 *
 * Three things this must get right, because they are the ones that bite:
 *
 *  1. **Derived values leak.** A Sales Executive who cannot see cost prices
 *     must not see margin, profit, or a total-cost-based sort either. Hiding
 *     the column is not enough — you have to close every path that reveals it.
 *  2. **Server-side or nothing.** UI hiding is a convenience. Every check here
 *     runs on the server, on every request.
 *  3. **Denials are evidence.** Every denial returns a reason and is logged.
 */

// ---------------------------------------------------------------- vocabulary

export type Permission = string; // 'vehicle.read' | 'vehicle.cost.read' | 'vehicle.*' | '*'

export const PERMISSIONS = {
  vehicle: ['read', 'create', 'update', 'delete', 'publish', 'cost.read', 'cost.update', 'margin.read', 'price.update'],
  contact: ['read', 'create', 'update', 'delete', 'export', 'dob.read', 'vulnerability.read', 'vulnerability.update'],
  lead: ['read', 'create', 'update', 'assign', 'delete'],
  deal: ['read', 'create', 'update', 'delete', 'discount.approve', 'margin.read'],
  finance: ['read', 'create', 'update', 'commission.read', 'commission.edit', 'evidence.export'],
  invoice: ['read', 'create', 'void', 'refund'],
  payment: ['read', 'create', 'refund', 'bank_details.update'],
  stockbook: ['read', 'export'],
  prep: ['read', 'update', 'cost.create', 'cost.approve'],
  supplier: ['read', 'create', 'update'],
  website: ['read', 'update', 'publish'],
  channel: ['read', 'update', 'publish'],
  report: ['read', 'export', 'financial.read'],
  compliance: ['read', 'update', 'evidence.export'],
  staff: ['read', 'create', 'update', 'commission.read'],
  settings: ['read', 'update', 'compliance.update'],
  billing: ['read', 'update'],
  tenant: ['delete'],
  user: ['invite', 'update', 'remove', 'permissions.update'],
} as const;

export const ALL_PERMISSIONS: Permission[] = Object.entries(PERMISSIONS).flatMap(
  ([resource, actions]) => (actions as readonly string[]).map((a) => `${resource}.${a}`),
);

/**
 * Field-level dependencies. If a user cannot read the source, they must not be
 * able to read anything derived from it — this is what stops a "profit" column
 * revealing a cost price the user was never meant to see.
 */
export const DERIVED_FROM: Record<string, Permission> = {
  'vehicle.margin': 'vehicle.cost.read',
  'vehicle.totalCost': 'vehicle.cost.read',
  'vehicle.purchasePrice': 'vehicle.cost.read',
  'vehicle.projectedMargin': 'vehicle.cost.read',
  'vehicle.minimumPrice': 'vehicle.cost.read',
  'deal.totalGrossProfit': 'deal.margin.read',
  'deal.vehicleMargin': 'deal.margin.read',
  'deal.addonMargin': 'deal.margin.read',
  'financeAgreement.commissionAmount': 'finance.commission.read',
  'financeAgreement.commissionType': 'finance.commission.read',
  'contact.dateOfBirth': 'contact.dob.read',
  'contact.vulnerability': 'contact.vulnerability.read',
  'payment.bankDetails': 'payment.bank_details.update',
};

/** Actions that always require a fresh re-authentication, whatever the role. */
export const STEP_UP_REQUIRED: ReadonlySet<Permission> = new Set([
  'contact.export',
  'payment.bank_details.update',
  'finance.commission.edit',
  'finance.evidence.export',
  'compliance.evidence.export',
  'user.permissions.update',
  'tenant.delete',
]);

/** Holding any of these forces MFA enrolment on the account. */
export const MFA_REQUIRED_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'contact.export',
  'finance.commission.read',
  'finance.commission.edit',
  'payment.bank_details.update',
  'billing.update',
  'tenant.delete',
]);

export type Scope = 'all_sites' | 'my_sites' | 'own_records';

export interface RoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
  scope: Scope;
  discountLimitPence?: number;
  refundLimitPence?: number;
}

const expand = (...patterns: string[]): Permission[] =>
  patterns.flatMap((p) =>
    p.endsWith('.*')
      ? ALL_PERMISSIONS.filter((perm) => perm.startsWith(`${p.slice(0, -2)}.`))
      : [p],
  );

// ---------------------------------------------------------------- the nine roles

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Everything, including billing and tenant deletion. Cannot be removed if last owner.',
    permissions: ['*'],
    scope: 'all_sites',
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Everything operational. No billing, no tenant deletion, no editing permissions above their own level.',
    permissions: expand(
      'vehicle.*', 'contact.*', 'lead.*', 'deal.*', 'finance.*', 'invoice.*', 'payment.*',
      'stockbook.*', 'prep.*', 'supplier.*', 'website.*', 'channel.*', 'report.*',
      'compliance.*', 'staff.*', 'settings.read', 'settings.update', 'user.invite', 'user.update',
    ),
    scope: 'all_sites',
    discountLimitPence: 150_000,
    refundLimitPence: 500_000,
  },
  {
    key: 'sales_executive',
    name: 'Sales Executive',
    description: 'Own leads and deals. Reads all stock. No cost prices, no margin, unless granted.',
    permissions: [
      'vehicle.read',
      'contact.read', 'contact.create', 'contact.update',
      'lead.read', 'lead.create', 'lead.update',
      'deal.read', 'deal.create', 'deal.update',
      'finance.read', 'finance.create',
      'invoice.read',
      'payment.read', 'payment.create',
      'prep.read',
      'report.read',
    ],
    scope: 'own_records',
    discountLimitPence: 25_000,
  },
  {
    key: 'business_manager',
    name: 'Business Manager / Administrator',
    description: 'Full deal, invoice, finance, document and compliance access. No cost editing unless granted.',
    permissions: [
      'vehicle.read', 'vehicle.update',
      ...expand('contact.*', 'lead.*', 'deal.*', 'finance.*', 'invoice.*', 'payment.*', 'compliance.*'),
      'stockbook.read', 'stockbook.export',
      'report.read', 'report.export',
      'settings.read',
    ],
    scope: 'all_sites',
    discountLimitPence: 100_000,
    refundLimitPence: 250_000,
  },
  {
    key: 'buyer',
    name: 'Buyer / Stock Controller',
    description: 'Full stock, purchase, valuation and supplier access. Read-only on CRM.',
    permissions: [
      ...expand('vehicle.*', 'supplier.*', 'prep.*'),
      'contact.read', 'lead.read', 'report.read', 'stockbook.read',
      'channel.read', 'channel.publish',
    ],
    scope: 'all_sites',
  },
  {
    key: 'prep',
    name: 'Prep / Workshop',
    description: 'Job cards, costs, media capture, status changes. No pricing, no customer data.',
    permissions: [
      'vehicle.read', 'vehicle.update',
      'prep.read', 'prep.update', 'prep.cost.create',
      'supplier.read',
    ],
    scope: 'my_sites',
  },
  {
    key: 'marketing',
    name: 'Marketing',
    description: 'Website, content, channels, campaigns, media. Read-only stock and reports.',
    permissions: [
      'vehicle.read', 'vehicle.update', 'vehicle.publish',
      ...expand('website.*', 'channel.*'),
      'contact.read', 'lead.read', 'report.read',
    ],
    scope: 'all_sites',
  },
  {
    key: 'accountant',
    name: 'Accountant (external)',
    description: 'Read-only financial data plus export. No customer PII beyond invoice requirements.',
    permissions: [
      'invoice.read', 'payment.read',
      'stockbook.read', 'stockbook.export',
      'report.read', 'report.export', 'report.financial.read',
      'vehicle.read', 'vehicle.cost.read',
      'supplier.read',
    ],
    scope: 'all_sites',
  },
  {
    key: 'read_only',
    name: 'Read-only / Auditor',
    description: 'Reads everything, changes nothing. For compliance consultants.',
    permissions: ALL_PERMISSIONS.filter((p) => /\.(read|export)$/.test(p)),
    scope: 'all_sites',
  },
];

export const roleByKey = (key: string): RoleDefinition | undefined =>
  SYSTEM_ROLES.find((r) => r.key === key);

// ---------------------------------------------------------------- evaluation

export interface Principal {
  userId: string;
  tenantId: string;
  roleKey: string;
  permissions: readonly Permission[];   // resolved: role + grants − revokes
  scope: Scope;
  siteIds: readonly string[];
  discountLimitPence?: number;
  refundLimitPence?: number;
  stepUpSatisfiedAt?: Date | null;
  mfaSatisfiedAt?: Date | null;
}

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: string; code: 'NO_PERMISSION' | 'OUT_OF_SCOPE' | 'STEP_UP_REQUIRED' | 'OVER_LIMIT' };

const STEP_UP_WINDOW_MS = 5 * 60_000;

/** Does a granted permission (possibly a wildcard) cover the one being asked for? */
export function matches(granted: Permission, wanted: Permission): boolean {
  if (granted === '*' || granted === wanted) return true;
  if (granted.endsWith('.*')) return wanted.startsWith(`${granted.slice(0, -2)}.`);
  return false;
}

export const holds = (principal: Principal, wanted: Permission): boolean =>
  principal.permissions.some((g) => matches(g, wanted));

/** Resolve a role's permissions with per-member grants and revocations applied. */
export function resolvePermissions(
  rolePermissions: readonly Permission[],
  overrides: { grant?: readonly Permission[]; revoke?: readonly Permission[] } = {},
): Permission[] {
  const granted = new Set([...rolePermissions, ...(overrides.grant ?? [])]);
  for (const revoked of overrides.revoke ?? []) {
    granted.delete(revoked);
    // Revoking a wildcard revokes everything it covered.
    if (revoked.endsWith('.*') || revoked === '*') {
      for (const g of [...granted]) if (matches(revoked, g)) granted.delete(g);
    }
    // Revoking a specific permission must also puncture a wildcard that covers
    // it, or the revocation would be silently ignored.
    for (const g of [...granted]) {
      if (g.endsWith('.*') && matches(g, revoked)) {
        granted.delete(g);
        for (const p of ALL_PERMISSIONS) {
          if (matches(g, p) && p !== revoked) granted.add(p);
        }
      }
      if (g === '*') {
        granted.delete(g);
        for (const p of ALL_PERMISSIONS) if (p !== revoked) granted.add(p);
      }
    }
  }
  return [...granted];
}

export interface AuthorizeOptions {
  siteId?: string | null;
  ownerId?: string | null;      // for own_records scope
  amountPence?: number;         // for threshold checks
  now?: Date;
}

export function authorize(
  principal: Principal,
  wanted: Permission,
  options: AuthorizeOptions = {},
): Decision {
  const now = options.now ?? new Date();

  if (!holds(principal, wanted)) {
    return { allowed: false, code: 'NO_PERMISSION', reason: `Missing permission: ${wanted}` };
  }

  // --- site / record scope ------------------------------------------------
  if (principal.scope === 'my_sites' && options.siteId) {
    if (!principal.siteIds.includes(options.siteId)) {
      return { allowed: false, code: 'OUT_OF_SCOPE', reason: 'Record belongs to another site' };
    }
  }
  if (principal.scope === 'own_records') {
    if (options.siteId && principal.siteIds.length && !principal.siteIds.includes(options.siteId)) {
      return { allowed: false, code: 'OUT_OF_SCOPE', reason: 'Record belongs to another site' };
    }
    // Writes are limited to their own records; reads are not.
    const isWrite = /\.(update|delete|assign|approve|void|refund)$/.test(wanted);
    if (isWrite && options.ownerId != null && options.ownerId !== principal.userId) {
      return { allowed: false, code: 'OUT_OF_SCOPE', reason: 'Record belongs to another user' };
    }
  }

  // --- step-up authentication ---------------------------------------------
  if (STEP_UP_REQUIRED.has(wanted)) {
    const at = principal.stepUpSatisfiedAt?.getTime();
    if (!at || now.getTime() - at > STEP_UP_WINDOW_MS) {
      return { allowed: false, code: 'STEP_UP_REQUIRED', reason: 'Re-authentication required for this action' };
    }
  }

  // --- value thresholds ----------------------------------------------------
  if (options.amountPence != null) {
    const limit =
      wanted.startsWith('deal.discount') ? principal.discountLimitPence
      : /refund/.test(wanted) ? principal.refundLimitPence
      : undefined;
    if (limit != null && options.amountPence > limit) {
      return { allowed: false, code: 'OVER_LIMIT', reason: `Exceeds your limit — needs approval` };
    }
  }

  return { allowed: true };
}

export function assertAuthorized(p: Principal, wanted: Permission, o: AuthorizeOptions = {}): void {
  const d = authorize(p, wanted, o);
  if (!d.allowed) {
    throw Object.assign(new Error(d.reason), { code: d.code, permission: wanted, userId: p.userId });
  }
}

// ---------------------------------------------------------------- redaction

/**
 * Strip fields the principal may not see, INCLUDING anything derived from them.
 * The payload must never contain a value that reveals a hidden one.
 */
export function redact<T extends Record<string, unknown>>(
  principal: Principal,
  resource: string,
  record: T,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const required = DERIVED_FROM[`${resource}.${key}`];
    if (required && !holds(principal, required)) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

/** Fields of a resource that this principal may not see. */
export const hiddenFields = (principal: Principal, resource: string): string[] =>
  Object.entries(DERIVED_FROM)
    .filter(([path, required]) => path.startsWith(`${resource}.`) && !holds(principal, required))
    .map(([path]) => path.slice(resource.length + 1));

/**
 * Sorting by a hidden field leaks its ordering, which for a small forecourt is
 * close to leaking the values. Filter the sort allow-list the same way.
 */
export const canSortBy = (principal: Principal, resource: string, field: string): boolean => {
  const required = DERIVED_FROM[`${resource}.${field}`];
  return !required || holds(principal, required);
};

export const requiresMfa = (permissions: readonly Permission[]): boolean =>
  [...MFA_REQUIRED_PERMISSIONS].some((p) => permissions.some((g) => matches(g, p)));
