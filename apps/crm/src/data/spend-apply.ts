/**
 * Recording what a channel cost.
 *
 * `channel_costs` is one figure per channel per month, enforced by a unique
 * index — so this is an UPSERT rather than an insert. That is deliberate and
 * it is the one place in the money layer where an update is right: this is not
 * a financial record of a transaction, it is the dealer telling us what their
 * Auto Trader invoice said, and they will correct it when the invoice arrives
 * to replace the estimate.
 *
 * The `estimated` flag is what keeps that honest. A figure the dealer has not
 * confirmed is marked, and the P&L says so on the row rather than presenting a
 * guess as an invoice.
 */

import type { Tx } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
import { money, format } from '@forecourt/domain';

export interface SpendOutcome {
  ok: boolean;
  error?: string;
  message?: string;
}

export interface SpendInput {
  channelLabel: string;
  /** ISO date; any day in the month is accepted and truncated. */
  month: string;
  amountPence: string;
  estimated: boolean;
  note: string;
}

export async function applyChannelSpend(
  tx: Tx,
  session: Session,
  input: SpendInput,
): Promise<SpendOutcome> {
  const label = input.channelLabel.trim();
  if (!label) return { ok: false, error: 'Choose which channel this spend is for.' };

  let amount: bigint;
  try {
    amount = BigInt(input.amountPence);
  } catch {
    return { ok: false, error: 'Enter the amount in pounds and pence, for example 1250.00.' };
  }
  if (amount < 0n) {
    return { ok: false, error: 'Spend cannot be negative. Record a credit as a lower figure.' };
  }

  const month = new Date(input.month);
  if (Number.isNaN(month.getTime())) {
    return { ok: false, error: 'Choose the month this spend belongs to.' };
  }

  const [before] = await tx`
    SELECT amount_pence, estimated FROM channel_costs
    WHERE channel_label = ${label}
      AND period_month = date_trunc('month', ${month}::timestamptz)
      AND site_id IS NULL`;

  await tx`
    INSERT INTO channel_costs (tenant_id, channel_label, period_month, amount_pence,
                               estimated, note, created_by, updated_by)
    VALUES (${session.tenantId}::uuid, ${label},
            date_trunc('month', ${month}::timestamptz)::date,
            ${amount.toString()}, ${input.estimated},
            ${input.note.trim() || null},
            ${session.userId}::uuid, ${session.userId}::uuid)
    ON CONFLICT (tenant_id, channel_label, period_month,
                 coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET amount_pence = EXCLUDED.amount_pence,
                  estimated = EXCLUDED.estimated,
                  note = EXCLUDED.note,
                  updated_at = now(),
                  updated_by = ${session.userId}::uuid`;

  await writeAudit({
    tx, session, resourceType: 'channel_cost', resourceId: null,
    action: before ? 'spend_corrected' : 'spend_recorded',
    before: before
      ? {
        channel: label,
        amount: (before['amount_pence'] as string) ?? null,
        estimated: before['estimated'],
      }
      : null,
    after: { channel: label, amount: amount.toString(), estimated: input.estimated },
  });

  return {
    ok: true,
    message: before
      ? `${label} updated to ${format(money(amount, 'GBP'))}${input.estimated ? ' (estimated)' : ''}.`
      : `${label} recorded at ${format(money(amount, 'GBP'))}${input.estimated ? ' (estimated)' : ''}.`,
  };
}
