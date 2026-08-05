-- 0020: the AML threshold version the schema says it retained.
--
-- M1 seeded `aml.hvd_threshold` version 2 with this note:
--
--     'Converted from EUR 10,000 to a fixed GBP 10,000 on 30 June 2026.
--      Version 1 (EUR) retained for pre-June-2026 records.'
--
-- Version 1 was never inserted. So the claim was untrue, and asking for the
-- threshold in force on any date before 30 June 2026 found no rule at all.
--
-- That matters because the threshold is assessed at the moment cash was
-- RECEIVED, not today: a payment taken in May 2026 is governed by the May
-- rule, and a system that cannot answer for May either throws or — worse, if
-- anyone ever "fixes" it with a fallback — silently applies a threshold that
-- did not exist yet. Found by a test that asked for the January 2026 rule and
-- got an exception.
--
-- `compliance_rules` is append-only and versioned, so this inserts the missing
-- history rather than editing anything, and closes version 1 on the date
-- version 2 takes over.
--
-- The EUR 10,000 figure is the Money Laundering Regulations 2017 high value
-- dealer threshold as it stood before the 2026 sterling conversion.
--
-- ⚠️ Like every other rule row, this is pending the retained consultant's
-- sign-off. It is history rather than current practice, which is why it ships
-- here rather than waiting.

BEGIN;

INSERT INTO compliance_rules (key, version, effective_from, effective_to,
                              parameters, source_url, notes, checked_at)
SELECT 'aml.hvd_threshold', 1, '2017-06-26', '2026-06-30',
       '{"amount_pence":1000000,"currency":"EUR"}',
       'https://www.legislation.gov.uk/uksi/2017/692/regulation/14',
       'EUR 10,000 high value dealer threshold under the Money Laundering Regulations 2017, '
       || 'superseded by a fixed GBP 10,000 on 30 June 2026. Retained so a payment received '
       || 'before that date is assessed against the rule that was actually in force.',
       '2026-08-05'
WHERE NOT EXISTS (
  SELECT 1 FROM compliance_rules WHERE key = 'aml.hvd_threshold' AND version = 1
);

-- No UPDATE here, and that is not an oversight: `compliance_rules` is
-- append-only by trigger, so an UPDATE would be refused outright. The
-- boundary is closed from the version 1 side instead — v1 runs to 2026-06-30
-- exclusive, v2 runs from 2026-06-30 with no end — so "the rule in force on
-- 29 June 2026" has exactly one answer and so does 30 June.
--
-- (An earlier draft of this migration did contain that UPDATE. It applied
-- cleanly only because its WHERE clause matched no rows; the moment it
-- matched one, the append-only trigger would have failed the migration.)

COMMIT;
