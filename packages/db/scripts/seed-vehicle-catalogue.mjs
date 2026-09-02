/**
 * Load make / model / variant from vehicle_details/*.csv.
 *
 * Idempotent: re-running updates names and slugs against source_id.
 * Connects as the database owner so RLS does not block the write — the
 * application roles have SELECT only.
 *
 *   pnpm db:seed:catalogue
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';
import { parseCsv } from './parse-csv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DETAILS = join(ROOT, 'vehicle_details');

const slug = (value) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const variantLabel = (typeName, name, hp) => {
  const power = hp > 0 ? `${hp} HP` : null;
  return [typeName || null, name, power].filter(Boolean).join(' · ');
};

const toInt = (raw) => {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

const databaseUrl = requireDatabaseUrl();
const needsSsl =
  process.env['PGSSLMODE'] === 'require'
  || /[?&]sslmode=require/i.test(databaseUrl)
  || /rlwy\.net|railway\.app/i.test(databaseUrl);

const sql = postgres(databaseUrl, {
  max: 1,
  onnotice: () => {},
  ...(needsSsl ? { ssl: 'require' } : {}),
});

const CHUNK = 400;

async function progress(table, done, total) {
  process.stdout.write(`\r  ${table.padEnd(22)} ${done} / ${total}`);
}

async function seed() {
  const [exists] = await sql`
    SELECT to_regclass('public.vehicle_makes') AS t`;
  if (!exists?.t) {
    console.error('vehicle_makes is missing. Run pnpm db:migrate (migration 0027) first.');
    process.exitCode = 1;
    return;
  }

  const manufacturers = parseCsv(readFileSync(join(DETAILS, 'manufacturers.csv'), 'utf8'));
  const modelsCsv = parseCsv(readFileSync(join(DETAILS, 'models.csv'), 'utf8'));
  const vehicles = parseCsv(readFileSync(join(DETAILS, 'vehicles.csv'), 'utf8'));

  const makes = [];
  const usedMakeSlugs = new Set();
  for (const row of manufacturers) {
    const name = (row.name ?? '').trim();
    const sourceId = toInt(row.id);
    if (!name || sourceId === null) continue;
    let s = slug(name) || `make-${sourceId}`;
    if (usedMakeSlugs.has(s)) s = `${s}-${sourceId}`;
    usedMakeSlugs.add(s);
    makes.push({ source_id: sourceId, name, slug: s });
  }

  console.log(`Seeding vehicle catalogue from ${DETAILS}`);
  for (let i = 0; i < makes.length; i += CHUNK) {
    const slice = makes.slice(i, i + CHUNK);
    await sql`
      INSERT INTO vehicle_makes (source_id, name, slug)
      SELECT * FROM jsonb_to_recordset(${sql.json(slice)})
        AS t(source_id integer, name text, slug text)
      ON CONFLICT (source_id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug`;
    progress('vehicle_makes', Math.min(i + CHUNK, makes.length), makes.length);
  }
  process.stdout.write('\n');

  const makeRows = await sql`SELECT id, name FROM vehicle_makes`;
  const makeIdByName = new Map(makeRows.map((r) => [String(r.name).toLowerCase(), r.id]));

  const models = [];
  const seenModel = new Set();
  const addModel = (makeName, modelName, sourceId) => {
    const makeId = makeIdByName.get(makeName.toLowerCase());
    if (!makeId) return;
    const name = modelName.trim();
    if (!name) return;
    const key = `${makeId}|${name.toLowerCase()}`;
    if (seenModel.has(key)) return;
    seenModel.add(key);
    models.push({
      make_id: makeId,
      source_id: sourceId,
      name,
      slug: slug(name) || `model-${sourceId ?? models.length}`,
    });
  };

  for (const row of modelsCsv) {
    addModel(row.manufacturer ?? '', row.name ?? '', toInt(row.id));
  }
  for (const row of vehicles) {
    addModel(row.manufacturer ?? '', row.model ?? '', null);
  }

  for (let i = 0; i < models.length; i += CHUNK) {
    const slice = models.slice(i, i + CHUNK);
    await sql`
      INSERT INTO vehicle_models (make_id, source_id, name, slug)
      SELECT (t->>'make_id')::uuid, NULLIF(t->>'source_id', '')::integer, t->>'name', t->>'slug'
        FROM jsonb_array_elements(${sql.json(slice)}) AS t
      ON CONFLICT (make_id, name) DO UPDATE
        SET slug = EXCLUDED.slug,
            source_id = COALESCE(vehicle_models.source_id, EXCLUDED.source_id)`;
    progress('vehicle_models', Math.min(i + CHUNK, models.length), models.length);
  }
  process.stdout.write('\n');

  const modelRows = await sql`
    SELECT m.id, m.name, mk.name AS make_name
      FROM vehicle_models m JOIN vehicle_makes mk ON mk.id = m.make_id`;
  const modelIdByKey = new Map(
    modelRows.map((r) => [`${String(r.make_name).toLowerCase()}|${String(r.name).toLowerCase()}`, r.id]),
  );

  const variants = [];
  const usedSlugs = new Set();
  for (const row of vehicles) {
    const sourceId = toInt(row.id);
    const makeName = (row.manufacturer ?? '').trim();
    const modelName = (row.model ?? '').trim();
    const name = (row.name ?? '').trim();
    if (sourceId === null || !name) continue;
    const modelId = modelIdByKey.get(`${makeName.toLowerCase()}|${modelName.toLowerCase()}`);
    if (!modelId) continue;
    const typeName = (row.type ?? '').trim() || null;
    const hp = toInt(row.hp);
    const kw = toInt(row.kw);
    let s = (row.slug ?? '').trim() || slug(`${makeName}-${modelName}-${name}-${sourceId}`);
    if (usedSlugs.has(s)) s = `${s}-${sourceId}`;
    usedSlugs.add(s);
    variants.push({
      model_id: modelId,
      source_id: sourceId,
      type_name: typeName,
      name,
      label: variantLabel(typeName, name, hp),
      kw,
      hp,
      slug: s.slice(0, 120),
    });
  }

  for (let i = 0; i < variants.length; i += CHUNK) {
    const slice = variants.slice(i, i + CHUNK);
    await sql`
      INSERT INTO vehicle_variants (model_id, source_id, type_name, name, label, kw, hp, slug)
      SELECT (t->>'model_id')::uuid,
             (t->>'source_id')::integer,
             NULLIF(t->>'type_name', ''),
             t->>'name',
             t->>'label',
             NULLIF(t->>'kw', '')::smallint,
             NULLIF(t->>'hp', '')::smallint,
             t->>'slug'
        FROM jsonb_array_elements(${sql.json(slice)}) AS t
      ON CONFLICT (source_id) DO UPDATE SET
        type_name = EXCLUDED.type_name,
        name = EXCLUDED.name,
        label = EXCLUDED.label,
        kw = EXCLUDED.kw,
        hp = EXCLUDED.hp,
        slug = EXCLUDED.slug`;
    progress('vehicle_variants', Math.min(i + CHUNK, variants.length), variants.length);
  }
  process.stdout.write('\n');

  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int FROM vehicle_makes) AS makes,
      (SELECT count(*)::int FROM vehicle_models) AS models,
      (SELECT count(*)::int FROM vehicle_variants) AS variants`;
  console.log(`✓ ${counts.makes} makes, ${counts.models} models, ${counts.variants} variants.`);
}

try {
  await seed();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
