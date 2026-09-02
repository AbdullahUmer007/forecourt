'use client';

import { useState } from 'react';
import {
  saveAppraisalOffer, decideOffer, saveAppraisalIdentity,
  takeIntoStock, withdrawAppraisal,
} from '@/data/appraisal-actions';
import { LABEL_CLASS, INPUT_CLASS, BUTTON_CLASS } from './styles';

export function AppraisalOfferForm({ appraisalId }: { appraisalId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await saveAppraisalOffer(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <form action={onSubmit} className="grid gap-2">
      {error && <p className="text-critical">{error}</p>}
      <input type="hidden" name="appraisalId" value={appraisalId} />
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Allowance (£)</span>
        <input className={INPUT_CLASS} name="allowance" required />
      </label>
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Trade value, if you have one (£)</span>
        <input className={INPUT_CLASS} name="market" />
      </label>
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Honour for (days)</span>
        <input className={INPUT_CLASS} name="days" type="number" defaultValue="7" />
      </label>
      <button type="submit" className={`${BUTTON_CLASS} border-brand-600 bg-brand-600 text-white`}>
        Record offer
      </button>
    </form>
  );
}

export function AppraisalDecision({ appraisalId }: { appraisalId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await decideOffer(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <form action={onSubmit} className="grid gap-2">
      {error && <p className="text-critical">{error}</p>}
      <input type="hidden" name="appraisalId" value={appraisalId} />
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>If they walked, why</span>
        <input className={INPUT_CLASS} name="reason" placeholder="Price, condition, bought elsewhere…" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button name="decision" value="accepted" className={`${BUTTON_CLASS} border-brand-600 bg-brand-600 text-white`}>
          Customer accepted
        </button>
        <button name="decision" value="declined" className={`${BUTTON_CLASS} border-edge-strong`}>
          Declined
        </button>
      </div>
    </form>
  );
}

export function AppraisalIdentityForm(
  { appraisalId, make, model, derivative }: {
    appraisalId: string; make: string; model: string; derivative: string;
  },
) {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await saveAppraisalIdentity(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <form action={onSubmit} className="grid gap-2 sm:grid-cols-2">
      {error && <p className="sm:col-span-2 text-critical">{error}</p>}
      <input type="hidden" name="appraisalId" value={appraisalId} />
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Make</span>
        <input className={INPUT_CLASS} name="make" defaultValue={make} />
      </label>
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>Model</span>
        <input className={INPUT_CLASS} name="model" defaultValue={model} />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={LABEL_CLASS}>Derivative — confirm, do not guess</span>
        <input className={INPUT_CLASS} name="derivative" defaultValue={derivative} />
      </label>
      <label className="grid gap-1 sm:col-span-2">
        <span className={LABEL_CLASS}>VAT invoice from a VAT-registered seller</span>
        <select className={INPUT_CLASS} name="vatInvoice" defaultValue="">
          <option value="">Not applicable / not asked</option>
          <option value="yes">Yes — VAT invoice received</option>
          <option value="no">No — they sold under the margin scheme</option>
        </select>
      </label>
      <button type="submit" className={`${BUTTON_CLASS} border-edge-strong sm:col-span-2`}>
        Save identity
      </button>
    </form>
  );
}

export function TakeIntoStockButton({ appraisalId, ready }: { appraisalId: string; ready: boolean }) {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await takeIntoStock(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <form action={onSubmit}>
      {error && <p className="mb-2 text-critical">{error}</p>}
      <input type="hidden" name="appraisalId" value={appraisalId} />
      <button
        type="submit"
        disabled={!ready}
        className={`${BUTTON_CLASS} border-brand-600 bg-brand-600 text-white`}
      >
        Take into stock
      </button>
    </form>
  );
}

export function WithdrawAppraisal({ appraisalId }: { appraisalId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await withdrawAppraisal(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <form action={onSubmit} className="grid gap-2 rounded-md border border-edge p-3">
      {error && <p className="text-critical">{error}</p>}
      <input type="hidden" name="appraisalId" value={appraisalId} />
      <p className="text-[13px] text-ink-muted">
        Withdraw this draft. Offers and valuations stay. Type WITHDRAW to confirm.
      </p>
      <input className={INPUT_CLASS} name="reason" placeholder="Why" required />
      <input className={INPUT_CLASS} name="confirm" placeholder="WITHDRAW" />
      <button type="submit" className={`${BUTTON_CLASS} border-critical text-critical`}>
        Withdraw
      </button>
    </form>
  );
}
