'use client';

import { useState } from 'react';
import { provisionDealership, type ProvisionOutcome } from '@/data/tenant-actions';

const FIELD =
  'min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3 text-ink';
const LABEL = 'text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle';

export function CreateDealershipForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProvisionOutcome | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setResult(null);
    const outcome = await provisionDealership(formData);
    setResult(outcome);
    setPending(false);
  }

  if (result?.ok) {
    return (
      <div className="grid gap-3 rounded-md border border-edge bg-surface-1 p-4">
        <h2 className="text-[16px] font-semibold">Dealership created</h2>
        <p className="text-ink-muted">
          Give these to the owner once. We store a hash, not the password, so we
          cannot show it again.
        </p>
        <p>
          <span className="text-ink-subtle">Email</span>
          <br />
          <code>{result.ownerEmail}</code>
        </p>
        <p>
          <span className="text-ink-subtle">Password</span>
          <br />
          <code className="break-all">{result.ownerPassword}</code>
        </p>
        {result.warnings.length > 0 && (
          <ul className="list-disc pl-5 text-[13px] text-ink-muted">
            {result.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <a className="text-link underline" href={`/tenants/${result.tenantId}`}>
          Open the dealership
        </a>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="grid gap-3">
      {result && !result.ok && (
        <p className="rounded-md border border-critical/40 bg-surface-1 p-3 text-critical">{result.error}</p>
      )}

      <label className="grid gap-1">
        <span className={LABEL}>Trading name</span>
        <input className={FIELD} name="name" required />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>Legal entity name</span>
        <input className={FIELD} name="legalName" required />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>Companies House number</span>
        <input className={FIELD} name="companiesHouseNo" />
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="vatRegistered" />
        <span>VAT registered</span>
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>VAT number</span>
        <input className={FIELD} name="vatNumber" />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>Default VAT scheme</span>
        <select className={FIELD} name="vatSchemeDefault" defaultValue="margin">
          <option value="margin">Margin scheme</option>
          <option value="qualifying">VAT qualifying</option>
          <option value="mixed">Mixed</option>
        </select>
      </label>

      <label className="grid gap-1">
        <span className={LABEL}>FCA permission</span>
        <select className={FIELD} name="fcaPermission" defaultValue="none">
          <option value="none">Does not introduce finance</option>
          <option value="limited">Limited permission (credit broker)</option>
          <option value="full">Full permission</option>
          <option value="appointed_rep">Appointed representative</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>FCA FRN</span>
        <input className={FIELD} name="fcaFrn" />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>AR principal name</span>
        <input className={FIELD} name="arPrincipalName" />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>AR principal FRN</span>
        <input className={FIELD} name="arPrincipalFrn" />
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="acceptsCash" />
        <span>Accepts cash</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="hvdRegistered" />
        <span>HMRC High Value Dealer registered</span>
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>HVD number</span>
        <input className={FIELD} name="hvdNumber" />
      </label>

      <label className="grid gap-1">
        <span className={LABEL}>First site name</span>
        <input className={FIELD} name="siteName" required defaultValue="Main forecourt" />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>Owner name</span>
        <input className={FIELD} name="ownerName" required />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>Owner email</span>
        <input className={FIELD} name="ownerEmail" type="email" required />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>Public hostname (optional)</span>
        <input className={FIELD} name="hostname" placeholder="example-motors.up.railway.app" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="markHostVerified" />
        <span>Mark the hostname verified — only for a host we control</span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create dealership'}
      </button>
    </form>
  );
}
