/**
 * Regulatory values, read from `compliance_rules` and keyed on a date.
 *
 * Rule 3: thresholds, rates, dates and windows are DATA. UK motor finance
 * regulation moved twice during research, so changing the law has to be a
 * data deployment rather than a code change. This is the read side of that
 * promise for the CRM.
 *
 * Keyed on the RELEVANT date, not on today: a deal delivered in March is
 * governed by the rule in force in March, and reading today's rule would
 * quietly re-date every historic clock the first time a rule version changes.
 * `compliance_rules` is append-only and versioned precisely so the old answer
 * survives.
 */

import { sql } from './db';
import type { ConsumerRightsRule } from '@forecourt/domain';

interface RuleRow {
  parameters: Record<string, unknown>;
  source_url: string;
  version: number;
}

/**
 * `compliance_rules` is PLATFORM data, not tenant data — the law is the same
 * for every dealer — so it is read outside `withSession`. It has no
 * `tenant_id` and the isolation suite lists it among the five special tables
 * for that reason.
 */
async function ruleAsAt(key: string, asAt: Date): Promise<RuleRow | null> {
  const [row] = await sql<RuleRow[]>`
    SELECT parameters, source_url, version FROM compliance_rules
    WHERE key = ${key}
      AND effective_from <= ${asAt}
      AND (effective_to IS NULL OR effective_to > ${asAt})
    ORDER BY effective_from DESC, version DESC
    LIMIT 1`;
  return row ?? null;
}

const int = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    // Not a silent default. A missing regulatory parameter means somebody
    // deployed a rule row that does not say what it must say, and quietly
    // substituting 30 days would be this system inventing the law.
    throw new Error(
      `compliance_rules is missing an integer \`${what}\`. The consumer-rights ` +
      `windows come from data, and there is no safe default to fall back to.`,
    );
  }
  return v;
};

/**
 * The Consumer Rights Act windows in force on a given date.
 *
 * Every one of 30 days, 6 months, 14 days and the 7-day repair-resume minimum
 * is read here rather than written anywhere in code.
 */
export async function consumerRightsRule(asAt: Date): Promise<ConsumerRightsRule> {
  const row = await ruleAsAt('cra.consumer_rights_windows', asAt);
  if (!row) {
    throw new Error(
      'No `cra.consumer_rights_windows` rule is in force for that date. ' +
      'The statutory clocks cannot be computed without one — check the ' +
      '`compliance_rules` table rather than hard-coding the windows.',
    );
  }

  const p = row.parameters;
  return {
    rejectWindowDays: int(p['reject_window_days'], 'reject_window_days'),
    repairResumeMinimumDays: int(p['repair_resume_minimum_days'], 'repair_resume_minimum_days'),
    burdenOfProofMonths: int(p['burden_of_proof_months'], 'burden_of_proof_months'),
    cancellationWindowDays: int(p['cancellation_window_days'], 'cancellation_window_days'),
    sourceUrl: row.source_url,
  };
}

/** The AML high-value-dealer threshold in force on a date, in pence. */
export async function amlThresholdPence(asAt: Date): Promise<bigint> {
  const row = await ruleAsAt('aml.hvd_threshold', asAt);
  if (!row) {
    throw new Error('No `aml.hvd_threshold` rule is in force for that date.');
  }
  return BigInt(int(row.parameters['amount_pence'], 'amount_pence'));
}
