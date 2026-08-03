/**
 * M2 — tenant provisioning.
 *
 * Goal from the functional spec (§1.2): from signed order to a live, populated,
 * published website in under 4 working hours of our time and under 60 minutes
 * of the dealer's — with no engineering involvement, ever.
 *
 * This module is pure: it validates the input and returns the plan. The caller
 * executes it in one transaction. Keeping it pure means the whole onboarding
 * path is unit-testable without a database.
 */

import { SYSTEM_ROLES, type Permission } from './permissions.js';

export type FcaPermission = 'limited' | 'full' | 'appointed_rep' | 'none';
export type VatSchemeDefault = 'margin' | 'qualifying' | 'mixed';

export interface TenantInput {
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
  tradeBodies?: string[];
  dataProtectionContact?: string;
  plan: string;
  owner: { email: string; name: string };
  firstSite: { name: string; timezone?: string };
}

export interface ValidationIssue {
  field: string;
  message: string;
  /** Blocks provisioning, or just warns. */
  severity: 'error' | 'warning';
  source?: string;
}

/**
 * Validate the compliance profile BEFORE a tenant exists.
 *
 * These mirror the CHECK constraints in 0001_tenancy.sql. Duplicating them here
 * is deliberate: the database is the guarantee, this is the good error message.
 */
export function validateTenantInput(input: TenantInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!input.name.trim()) issues.push({ field: 'name', message: 'Trading name is required', severity: 'error' });
  if (!input.legalName.trim()) issues.push({ field: 'legalName', message: 'Legal entity name is required', severity: 'error' });

  // --- FCA ---------------------------------------------------------------
  if (input.fcaPermission !== 'none' && !input.fcaFrn?.trim()) {
    issues.push({
      field: 'fcaFrn',
      message: 'A firm that introduces finance must record its Firm Reference Number',
      severity: 'error',
      source: 'https://www.fca.org.uk/firms/authorisation/consumer-credit-brokers/secondary-credit-brokers',
    });
  }
  if (input.fcaPermission === 'appointed_rep') {
    if (!input.arPrincipalName?.trim() || !input.arPrincipalFrn?.trim()) {
      issues.push({
        field: 'arPrincipal',
        message:
          'An Appointed Representative must name its principal firm and FRN — they appear on the initial ' +
          'disclosure and on every finance promotion',
        severity: 'error',
        source: 'https://www.handbook.fca.org.uk/handbook/SUP/12/',
      });
    }
  }
  if (input.fcaPermission === 'none') {
    issues.push({
      field: 'fcaPermission',
      message:
        'No FCA permission recorded — finance features will be disabled. Introducing a customer to a lender ' +
        'is credit broking and is regulated whether or not you lend.',
      severity: 'warning',
    });
  }

  // --- VAT ----------------------------------------------------------------
  if (input.vatRegistered && !input.vatNumber?.trim()) {
    issues.push({ field: 'vatNumber', message: 'VAT registration number is required', severity: 'error' });
  }
  if (!input.vatRegistered && input.vatSchemeDefault !== 'margin') {
    issues.push({
      field: 'vatSchemeDefault',
      message: 'A non-VAT-registered dealer cannot operate the qualifying scheme',
      severity: 'error',
    });
  }

  // --- AML ----------------------------------------------------------------
  if (input.hvdRegistered && !input.hvdNumber?.trim()) {
    issues.push({ field: 'hvdNumber', message: 'HMRC High Value Dealer registration number is required', severity: 'error' });
  }
  if (input.acceptsCash && !input.hvdRegistered) {
    issues.push({
      field: 'acceptsCash',
      message:
        'You accept cash but are not registered with HMRC as a High Value Dealer. Registration must happen ' +
        'BEFORE accepting a payment at or above the threshold — it cannot be applied retrospectively. ' +
        'Cash payments will be capped until this is resolved.',
      severity: 'warning',
      source: 'https://www.gov.uk/guidance/money-laundering-regulations-high-value-dealer-registration',
    });
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.owner.email)) {
    issues.push({ field: 'owner.email', message: 'A valid owner email address is required', severity: 'error' });
  }
  if (!input.firstSite.name.trim()) {
    issues.push({ field: 'firstSite.name', message: 'The first site needs a name', severity: 'error' });
  }

  return issues;
}

export const canProvision = (issues: readonly ValidationIssue[]): boolean =>
  !issues.some((i) => i.severity === 'error');

// ---------------------------------------------------------------- the plan

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  isSystem: true;
  permissions: Permission[];
  scopeAllSites: boolean;
  discountLimitPence: number | null;
  refundLimitPence: number | null;
}

export interface ProvisioningPlan {
  tenant: Omit<TenantInput, 'owner' | 'firstSite'> & { status: 'provisioning' };
  site: { name: string; timezone: string };
  brand: { name: string; isDefault: true; toneOfVoice: string };
  roles: RoleSeed[];
  ownerRoleKey: 'owner';
  owner: { email: string; name: string };
  documentTemplates: string[];
  goLiveChecklist: ChecklistItem[];
  warnings: ValidationIssue[];
}

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
}

/**
 * A tenant is not marked live until every required item is satisfied. This is
 * what stops a half-configured dealer publishing a site with no stock, no
 * photographs, or an incomplete VAT stock book.
 */
export const GO_LIVE_CHECKLIST: readonly ChecklistItem[] = [
  { key: 'compliance_profile', label: 'Compliance profile complete', required: true },
  { key: 'site_configured', label: 'At least one site with an address and opening hours', required: true },
  { key: 'branding', label: 'Logo and theme applied', required: true },
  { key: 'stock_imported', label: 'At least one vehicle in stock', required: true },
  { key: 'stock_book_complete', label: 'Every vehicle has its mandatory VAT stock-book fields', required: true },
  { key: 'hero_images', label: 'Every live vehicle has at least one published photograph', required: true },
  { key: 'domain_verified', label: 'Custom domain verified and TLS issued', required: true },
  { key: 'website_preflight', label: 'Website passes the performance and structured-data pre-flight', required: true },
  { key: 'channel_validated', label: 'At least one marketplace channel published successfully', required: true },
  { key: 'test_lead', label: 'A test enquiry has been received end to end', required: true },
  { key: 'test_invoice', label: 'A test invoice has been generated and voided', required: true },
  { key: 'users_invited', label: 'Staff invited', required: false },
  { key: 'accounting_connected', label: 'Accounting package connected', required: false },
  { key: 'finance_connected', label: 'Finance platform connected', required: false },
];

const DOCUMENT_TEMPLATES = [
  'quotation', 'order_form', 'order_terms', 'sales_invoice', 'part_ex_purchase_invoice',
  'pdi_checklist', 'handover_checklist', 'warranty_certificate', 'initial_disclosure',
  'cancellation_notice', 'commission_disclosure', 'complaints_procedure', 'privacy_notice',
  'consent_wording',
];

export function buildProvisioningPlan(input: TenantInput): ProvisioningPlan {
  const issues = validateTenantInput(input);
  if (!canProvision(issues)) {
    const errors = issues.filter((i) => i.severity === 'error');
    throw Object.assign(new Error(`Cannot provision tenant: ${errors.map((e) => e.message).join('; ')}`), {
      code: 'VALIDATION_FAILED',
      issues: errors,
    });
  }

  const { owner, firstSite, ...tenantFields } = input;

  return {
    tenant: { ...tenantFields, status: 'provisioning' },
    site: { name: firstSite.name, timezone: firstSite.timezone ?? 'Europe/London' },
    brand: { name: input.name, isDefault: true, toneOfVoice: 'straight_talking' },
    // Each tenant gets its OWN copy of the nine system roles, so it can edit
    // them without affecting anyone else.
    roles: SYSTEM_ROLES.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: true as const,
      permissions: [...r.permissions],
      scopeAllSites: r.scope === 'all_sites',
      discountLimitPence: r.discountLimitPence ?? null,
      refundLimitPence: r.refundLimitPence ?? null,
    })),
    ownerRoleKey: 'owner',
    owner,
    documentTemplates: DOCUMENT_TEMPLATES,
    goLiveChecklist: [...GO_LIVE_CHECKLIST],
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}

/** Which required checklist items are still outstanding. */
export const outstandingChecklistItems = (satisfied: readonly string[]): ChecklistItem[] =>
  GO_LIVE_CHECKLIST.filter((i) => i.required && !satisfied.includes(i.key));

export const canTenantGoLive = (satisfied: readonly string[]): boolean =>
  outstandingChecklistItems(satisfied).length === 0;

export const goLiveProgress = (satisfied: readonly string[]): number => {
  const required = GO_LIVE_CHECKLIST.filter((i) => i.required);
  const done = required.filter((i) => satisfied.includes(i.key)).length;
  return Math.round((done / required.length) * 100);
};
