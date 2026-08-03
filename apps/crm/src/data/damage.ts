'use server';

import { revalidatePath } from 'next/cache';
import { withSession } from './db';
import { writeAudit } from './audit';
import { requireSession } from '@/auth/session';
import { storeAppraisalPhoto } from '@/media/store';
import {
  panelGroupFor, authorize, resolveStandard,
  type DamageType, type DamageSeverity, type ReconStandard,
} from '@forecourt/domain';

const DAMAGE_TYPES: readonly DamageType[] = [
  'scratch', 'dent', 'scuff', 'chip', 'crack', 'corrosion', 'missing',
  'paint_mismatch', 'kerbing', 'tear', 'stain', 'warning_light', 'wear',
];
const SEVERITIES: readonly DamageSeverity[] = ['light', 'moderate', 'heavy'];

export interface MarkResult {
  ok: boolean;
  error?: string;
  /** Set when the mark was recorded but nothing could price it. */
  warning?: string;
}

/**
 * Record a damage mark.
 *
 * Everything that makes this a mutation rather than an INSERT happens here:
 *
 *   1. A server-side permission check. The UI hiding a button is a
 *      convenience; this is the control.
 *   2. Validation against the enums, because the panel and the type arrive
 *      from a form and a form is caller-supplied.
 *   3. The standard cost resolved and STORED on the row, so the offer stays
 *      explicable after the bodyshop puts its prices up.
 *   4. The photo through M5's pipeline — magic-byte validation and a mandatory
 *      EXIF strip — before anything is written.
 *   5. The insert and its audit event in ONE transaction. An audit row that
 *      commits separately can outlive a rolled-back change and describe
 *      something that never happened.
 *
 * Takes `(previousState, formData)` so it can be used with `useActionState`
 * and passed STRAIGHT to `<form action=…>`. That matters beyond tidiness: a
 * form wired to a plain client handler does not work without JavaScript, and
 * this one is used on a forecourt on a bad connection. It also means the
 * action is reachable by an ordinary POST, which is the only reason the
 * `'use server'` export bug below was ever found.
 */
export async function recordDamageMark(
  _previous: MarkResult | null,
  formData: FormData,
): Promise<MarkResult> {
  const session = await requireSession();

  // The control. `vehicle.update` is what appraising a car needs; a prep user
  // has it, an accountant does not.
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt,
    mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'vehicle.update');

  if (!decision.allowed) {
    return { ok: false, error: decision.reason };
  }

  const appraisalId = String(formData.get('appraisalId') ?? '');
  const panel = String(formData.get('panel') ?? '').trim().toLowerCase();
  const damageType = String(formData.get('damageType') ?? '') as DamageType;
  const severity = String(formData.get('severity') ?? '') as DamageSeverity;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const sizeRaw = String(formData.get('sizeMm') ?? '').trim();

  const panelGroup = panelGroupFor(panel);
  if (!panelGroup) {
    // Never guess. A mark costed against the wrong group is a wrong estimate
    // that looks entirely normal on screen.
    return { ok: false, error: `“${panel}” is not a panel we recognise. Pick one from the map.` };
  }
  if (!DAMAGE_TYPES.includes(damageType)) {
    return { ok: false, error: 'Choose what kind of damage it is.' };
  }
  if (!SEVERITIES.includes(severity)) {
    return { ok: false, error: 'Choose how bad it is — light, moderate or heavy.' };
  }

  const sizeMm = sizeRaw === '' ? null : Number(sizeRaw);
  if (sizeMm !== null && (!Number.isFinite(sizeMm) || sizeMm < 0 || sizeMm > 5000)) {
    return { ok: false, error: 'Size must be a measurement in millimetres, or left blank.' };
  }

  // Photo first: it can fail on validation, and failing after the row is
  // written leaves a mark claiming a photograph that does not exist.
  const file = formData.get('photo');
  let photoKey: string | null = null;
  if (file instanceof File && file.size > 0) {
    const stored = await storeAppraisalPhoto(session.tenantId, appraisalId, file);
    if (!stored.ok) return { ok: false, error: stored.error };
    photoKey = stored.key;
  }

  const result = await withSession(session, async (tx) => {
    // Confirm the appraisal is ours and still open. RLS already guarantees the
    // first; this turns "no rows" into a sentence rather than a foreign-key
    // error, and refuses to add damage to a converted appraisal.
    const [appraisal] = await tx<{ id: string; state: string; site_id: string | null }[]>`
      SELECT id, state, site_id FROM appraisals WHERE id = ${appraisalId}::uuid`;

    if (!appraisal) {
      return { ok: false, error: 'That appraisal does not exist, or it is not yours.' };
    }
    if (appraisal.state === 'converted') {
      return {
        ok: false,
        error: 'This appraisal is already a stock record. Record the damage against the vehicle instead.',
      };
    }

    const standards = await tx<{
      id: string; damage_type: string; severity: string; panel_group: string;
      cost_pence: string; source: string; sample_size: number | null;
      effective_from: Date; effective_to: Date | null;
    }[]>`
      SELECT id, damage_type, severity, panel_group, cost_pence, source, sample_size,
             effective_from, effective_to
      FROM recon_cost_standards
      WHERE damage_type = ${damageType}::damage_type
        AND severity = ${severity}::damage_severity
        AND panel_group = ${panelGroup}::panel_group`;

    // Resolved by the SAME domain function the estimate uses, so a mark can
    // never be stored at a price the estimate would not have given it —
    // including the minimum-sample rule on an observed average.
    const resolved = resolveStandard(
      standards.map((s): ReconStandard => ({
        id: s.id,
        damageType: s.damage_type as DamageType,
        severity: s.severity as DamageSeverity,
        panelGroup: panelGroup,
        cost: { amount: BigInt(s.cost_pence), currency: 'GBP' },
        source: s.source as ReconStandard['source'],
        sampleSize: s.sample_size,
        effectiveFrom: s.effective_from,
        effectiveTo: s.effective_to,
      })),
      { damageType, severity, panelGroup },
      new Date(),
    );

    const [inserted] = await tx<{ id: string }[]>`
      INSERT INTO appraisal_damage (tenant_id, appraisal_id, panel, panel_group,
                                    damage_type, severity, size_mm, notes, photo_key,
                                    estimate_pence, created_by)
      VALUES (${session.tenantId}::uuid, ${appraisalId}::uuid, ${panel},
              ${panelGroup}::panel_group, ${damageType}::damage_type,
              ${severity}::damage_severity, ${sizeMm}, ${notes}, ${photoKey},
              ${resolved ? resolved.cost.amount.toString() : null},
              ${session.userId}::uuid)
      RETURNING id`;

    await writeAudit({
      tx, session,
      resourceType: 'appraisal_damage',
      resourceId: inserted!.id,
      action: 'create',
      siteId: appraisal.site_id,
      after: {
        appraisalId, panel, panelGroup, damageType, severity, sizeMm, notes,
        photoKey, estimatePence: resolved ? resolved.cost.amount.toString() : null,
      },
    });

    return {
      ok: true,
      ...(resolved ? {} : {
        warning:
          `Recorded, but there is no standard cost for a ${severity} ` +
          `${damageType.replace(/_/g, ' ')} on ${panelGroup.replace(/_/g, ' ')}, so it is not ` +
          'in the estimate. Price it before you make an offer.',
      }),
    };
  });

  if (result.ok) revalidatePath(`/appraisals/${appraisalId}`);
  return result as MarkResult;
}

// NOTE: nothing but async functions may be exported from this file. It carries
// `'use server'`, and Next refuses a module that exports anything else — "A
// 'use server' file can only export async functions, found number". Neither
// lint nor tsc catches it; the failure only appears when the action is
// actually invoked, which is how this comment came to exist.
