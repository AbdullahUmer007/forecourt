/**
 * Recording what buyers looked for and did not find.
 *
 * Append-only and partitioned. Only thin and empty results reach this table —
 * `demandSignal` decides that, not this module — because logging every search
 * would bury the signal and store far more visitor behaviour than we need.
 *
 * This is the one WRITE the public site performs. It goes through the
 * privileged pool rather than the read-only `app_public` role, and it is a
 * single INSERT of a normalised query with nothing identifying in it: no IP,
 * no session, no shortlist token. What a dealer buys stock from is "eleven
 * people wanted an automatic Qashqai under £12,000", not who they were.
 */

import { sql } from './db.js';
import type { DemandSignal } from '../../../../packages/domain/src/search.js';

export async function recordDemandSignal(tenantId: string, signal: DemandSignal): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantId}::uuid, NULL, '{}'::uuid[], true)`;
      await tx`
        INSERT INTO search_events
          (tenant_id, canonical_path, make, model, max_price_pence, keyword, result_count, occurred_at)
        VALUES (
          ${tenantId}::uuid, ${signal.canonicalPath}, ${signal.make}, ${signal.model},
          ${signal.maxPricePence === null ? null : String(signal.maxPricePence)},
          ${signal.keyword}, ${signal.resultCount}, ${signal.occurredAt}
        )`;
    });
  } catch (error) {
    // A failed demand log must never take the page down with it. The buyer is
    // mid-search; they do not care that our analytics insert missed a
    // partition. Log it and serve the page.
    console.warn('[forecourt] demand signal not recorded:', (error as Error).message);
  }
}
