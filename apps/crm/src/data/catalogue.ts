/**
 * Shared make / model / variant list. Platform data — no tenant_id.
 * Readable inside a session because RLS allows SELECT to every role.
 */

import { uniqueByName } from '@forecourt/domain';
import { withSession, type Tx } from './db';
import type { Session } from '@/auth/session';

export interface CatalogueMake {
  id: string;
  name: string;
}

export interface CatalogueModel {
  id: string;
  makeId: string;
  name: string;
}

export interface CatalogueVariant {
  id: string;
  modelId: string;
  name: string;
  label: string;
  hp: number | null;
}

export interface CatalogueMatch {
  make: CatalogueMake | null;
  model: CatalogueModel | null;
  variant: CatalogueVariant | null;
}

export async function catalogueIsLoaded(tx: Tx): Promise<boolean> {
  const [row] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM vehicle_makes`;
  return (row?.n ?? 0) > 0;
}

export async function listMakes(session: Session, q = ''): Promise<CatalogueMake[]> {
  return withSession(session, (tx) => listMakesTx(tx, q));
}

export async function listMakesTx(tx: Tx, q = ''): Promise<CatalogueMake[]> {
  const needle = q.trim();
  const rows = needle
    ? await tx<{ id: string; name: string }[]>`
        SELECT id, name FROM vehicle_makes
         WHERE name ILIKE ${`%${needle}%`}
         ORDER BY name LIMIT 200`
    : await tx<{ id: string; name: string }[]>`
        SELECT id, name FROM vehicle_makes ORDER BY name`;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function listModelsTx(tx: Tx, makeId: string, q = ''): Promise<CatalogueModel[]> {
  const needle = q.trim();
  const rows = needle
    ? await tx<{ id: string; make_id: string; name: string }[]>`
        SELECT id, make_id, name FROM vehicle_models
         WHERE make_id = ${makeId}::uuid AND name ILIKE ${`%${needle}%`}
         ORDER BY name LIMIT 400`
    : await tx<{ id: string; make_id: string; name: string }[]>`
        SELECT id, make_id, name FROM vehicle_models
         WHERE make_id = ${makeId}::uuid ORDER BY name`;
  return rows.map((r) => ({ id: r.id, makeId: r.make_id, name: r.name }));
}

export async function listVariantsTx(tx: Tx, modelId: string, q = ''): Promise<CatalogueVariant[]> {
  const needle = q.trim();
  const rows = needle
    ? await tx<{ id: string; model_id: string; name: string; label: string; hp: number | null }[]>`
        SELECT id, model_id, name, label, hp FROM vehicle_variants
         WHERE model_id = ${modelId}::uuid
           AND (label ILIKE ${`%${needle}%`} OR name ILIKE ${`%${needle}%`})
         ORDER BY label LIMIT 400`
    : await tx<{ id: string; model_id: string; name: string; label: string; hp: number | null }[]>`
        SELECT id, model_id, name, label, hp FROM vehicle_variants
         WHERE model_id = ${modelId}::uuid ORDER BY label LIMIT 800`;
  return rows.map((r) => ({
    id: r.id, modelId: r.model_id, name: r.name, label: r.label, hp: r.hp,
  }));
}

export async function listModels(session: Session, makeId: string, q = ''): Promise<CatalogueModel[]> {
  return withSession(session, (tx) => listModelsTx(tx, makeId, q));
}

export async function listVariants(session: Session, modelId: string, q = ''): Promise<CatalogueVariant[]> {
  return withSession(session, (tx) => listVariantsTx(tx, modelId, q));
}

export type CatalogueProblem = { field: 'make' | 'model' | 'derivative'; message: string };

/**
 * Resolve typed values against the catalogue. Empty fields stay empty.
 * A value that is not in the list is refused — we do not invent a derivative.
 */
export async function matchCatalogue(
  tx: Tx,
  input: { make: string | null; model: string | null; derivative: string | null },
): Promise<{ ok: true; match: CatalogueMatch } | { ok: false; problems: CatalogueProblem[] }> {
  if (!(await catalogueIsLoaded(tx))) {
    return { ok: true, match: { make: null, model: null, variant: null } };
  }

  const problems: CatalogueProblem[] = [];
  let make: CatalogueMake | null = null;
  let model: CatalogueModel | null = null;
  let variant: CatalogueVariant | null = null;

  if (input.make) {
    const makes = await listMakesTx(tx, input.make);
    const hit = uniqueByName(makes, input.make);
    if (!hit.ok) {
      problems.push({
        field: 'make',
        message: hit.reason === 'ambiguous'
          ? 'Several makes match what you typed. Pick one from the list.'
          : `"${input.make}" is not a make we know. Pick one from the list — we do not invent one.`,
      });
    } else {
      make = hit.row;
    }
  }

  if (input.model) {
    if (!make) {
      problems.push({
        field: 'model',
        message: 'Pick the make first, then the model.',
      });
    } else {
      const models = await listModelsTx(tx, make.id, input.model);
      const hit = uniqueByName(models, input.model);
      if (!hit.ok) {
        problems.push({
          field: 'model',
          message: hit.reason === 'ambiguous'
            ? 'Several models match. Pick the right one — a guessed model is a wrong price.'
            : `"${input.model}" is not a model of ${make.name}. Pick one from the list.`,
        });
      } else {
        model = hit.row;
      }
    }
  }

  if (input.derivative) {
    if (!model) {
      problems.push({
        field: 'derivative',
        message: 'Pick the model first, then the derivative. Do not guess the trim.',
      });
    } else {
      const variants = await listVariantsTx(tx, model.id, input.derivative);
      const hit = uniqueByName(variants, input.derivative);
      if (!hit.ok) {
        problems.push({
          field: 'derivative',
          message: hit.reason === 'ambiguous'
            ? 'Several trims match. Pick the right one — a guessed derivative is a wrong price and a mis-described vehicle.'
            : `"${input.derivative}" is not a derivative of ${model.name}. Pick one from the list.`,
        });
      } else {
        variant = hit.row;
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, match: { make, model, variant } };
}
