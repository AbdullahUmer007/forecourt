-- 0021: a data breach records whether it is high risk to the people affected.
--
-- M19 modelled the Article 33 decision — report to the ICO, or record why it
-- is not reportable — but not the Article 34 one, which is a different
-- question with a different answer:
--
--   Art 33: tell the REGULATOR within 72 hours, unless the breach is unlikely
--           to result in a risk to rights and freedoms.
--   Art 34: tell the PEOPLE AFFECTED without undue delay, where the breach is
--           likely to result in a HIGH risk to them.
--
-- `data_breaches` had `subjects_notified_at` but nothing saying whether they
-- should have been told. The domain's `breachClock` takes a `highRisk` flag
-- and there was no column to fill it from, so the CRM read a field that did
-- not exist and every breach evaluated as low risk — meaning the one statement
-- that says "these people have not been told" could never fire.
--
-- Nullable ON PURPOSE. Three states, not two:
--
--   NULL   nobody has assessed the risk to the people affected yet. That is a
--          finding in itself, and it is NOT the same as "low risk" — the same
--          reasoning as M19's completeness score, which never counts an
--          unassessable area as a pass.
--   false  assessed, and judged not high risk. Needs a reason, exactly as the
--          Article 33 not-reportable decision does: a decision, never a
--          silence.
--   true   assessed as high risk. The people affected must be told.
--
-- Rollback: 0021_breach_risk.down.sql drops both columns. Any assessment
-- recorded in them is lost, which is why the down migration says so.
--
-- ⚠️ Pending the retained consultant's sign-off, like every other rule here.

BEGIN;

ALTER TABLE data_breaches
  ADD COLUMN high_risk        boolean,
  ADD COLUMN high_risk_reason text;

COMMENT ON COLUMN data_breaches.high_risk IS
  'Article 34 assessment. NULL = not yet assessed, which is a finding rather than a low-risk answer.';

-- Judging a breach NOT high risk is a decision with a justification, the same
-- shape as `breach_not_reportable_has_reason` above it. Judging it high risk
-- needs no reason — the obligation follows automatically.
ALTER TABLE data_breaches
  ADD CONSTRAINT breach_low_risk_has_reason CHECK (
    high_risk IS DISTINCT FROM false OR high_risk_reason IS NOT NULL
  );

COMMIT;
