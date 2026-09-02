'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOperator, operatorCan } from '@/auth/session';
import { executeProvisioningPlan, type ProvisionInput } from './provision';
import { connectDomain, setTenantStatus } from './platform';
import type { FcaPermission, VatSchemeDefault } from '@forecourt/domain';

const bool = (form: FormData, key: string): boolean => form.get(key) === 'on' || form.get(key) === 'true';

export type ProvisionOutcome =
  | { ok: true; tenantId: string; ownerEmail: string; ownerPassword: string; warnings: string[] }
  | { ok: false; error: string };

export async function provisionDealership(formData: FormData): Promise<ProvisionOutcome> {
  const session = await requireOperator();
  if (!operatorCan(session, 'operator.manage')) {
    return { ok: false, error: 'Only a platform admin can create a dealership.' };
  }

  const optional = (key: string): string | undefined => {
    const v = String(formData.get(key) ?? '').trim();
    return v === '' ? undefined : v;
  };
  const input: ProvisionInput = {
    name: String(formData.get('name') ?? ''),
    legalName: String(formData.get('legalName') ?? ''),
    vatRegistered: bool(formData, 'vatRegistered'),
    fcaPermission: (String(formData.get('fcaPermission') ?? 'none') as FcaPermission),
    vatSchemeDefault: (String(formData.get('vatSchemeDefault') ?? 'margin') as VatSchemeDefault),
    acceptsCash: bool(formData, 'acceptsCash'),
    hvdRegistered: bool(formData, 'hvdRegistered'),
    plan: String(formData.get('plan') ?? 'pro'),
    ownerName: String(formData.get('ownerName') ?? ''),
    ownerEmail: String(formData.get('ownerEmail') ?? ''),
    siteName: String(formData.get('siteName') ?? ''),
    markHostVerified: bool(formData, 'markHostVerified'),
  };
  const house = optional('companiesHouseNo');
  const vat = optional('vatNumber');
  const frn = optional('fcaFrn');
  const arName = optional('arPrincipalName');
  const arFrn = optional('arPrincipalFrn');
  const hvd = optional('hvdNumber');
  const host = optional('hostname');
  if (house) input.companiesHouseNo = house;
  if (vat) input.vatNumber = vat;
  if (frn) input.fcaFrn = frn;
  if (arName) input.arPrincipalName = arName;
  if (arFrn) input.arPrincipalFrn = arFrn;
  if (hvd) input.hvdNumber = hvd;
  if (host) input.hostname = host;

  const result = await executeProvisioningPlan(input, session.userId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/');
  return {
    ok: true,
    tenantId: result.tenantId,
    ownerEmail: result.ownerEmail,
    ownerPassword: result.ownerPassword,
    warnings: result.warnings.map((w) => w.message),
  };
}

export async function changeTenantStatus(formData: FormData): Promise<void> {
  const session = await requireOperator();
  if (!operatorCan(session, 'operator.manage')) redirect('/');
  const tenantId = String(formData.get('tenantId') ?? '');
  const status = String(formData.get('status') ?? '') as
    'provisioning' | 'trial' | 'live' | 'suspended' | 'cancelled';
  await setTenantStatus(tenantId, status, session.userId);
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath('/');
}

export async function attachDomain(formData: FormData): Promise<void> {
  const session = await requireOperator();
  if (!operatorCan(session, 'operator.manage')) redirect('/');
  const tenantId = String(formData.get('tenantId') ?? '');
  await connectDomain(
    tenantId,
    String(formData.get('hostname') ?? ''),
    session.userId,
    formData.get('markVerified') === 'on',
  );
  revalidatePath(`/tenants/${tenantId}`);
}
