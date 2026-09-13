import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { resetMediaBackendForTests } from '../../packages/media/src/index';
import { sql, withSession } from '@/data/db';
import { applyBookIn, type VehicleFormInput } from '@/data/vehicle-apply';
import { loadStock, loadStockOverview } from '@/data/stock';
import { addVehiclePhoto, updateVehiclePhoto } from '@/data/media-apply';
import { ensureFixtures, session, T } from './fixtures';

const vehicle = randomUUID();
const first = randomUUID();
const second = randomUUID();
const booked: string[] = [];
beforeAll(async () => {
  await ensureFixtures();
  await sql`UPDATE vehicles SET deleted_at = now() WHERE tenant_id = ${T.tenant}::uuid AND registration IN ('DX26UIA', 'DX26UIB') AND notes = 'Test only'`;
  await sql`DELETE FROM vehicle_media WHERE vehicle_id IN (SELECT id FROM vehicles WHERE tenant_id = ${T.tenant}::uuid AND stock_number = 'UI-SEARCH-762')`;
  await sql`DELETE FROM vehicles WHERE tenant_id = ${T.tenant}::uuid AND stock_number = 'UI-SEARCH-762'`;
  await sql`INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence, registration, make, model, state, retail_price_pence)
    VALUES (${vehicle}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, 'UI-SEARCH-762', 897762, 'ZX26UIT', 'Workspace', 'Test', 'in_prep', 1299500)`;
  for (const id of [first, second]) await sql`INSERT INTO vehicle_media (id, tenant_id, site_id, vehicle_id, kind, status, storage_key, published, is_hero, exif_stripped)
    VALUES (${id}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${vehicle}::uuid, 'photo', 'ready', ${'test/' + id}, true, ${id === first}, true)`;
});
afterAll(async () => {
  for (const id of booked) {
    await sql`UPDATE vehicles SET deleted_at = now() WHERE id = ${id}::uuid`;
  }
  await sql`DELETE FROM vehicle_media WHERE vehicle_id = ${vehicle}::uuid`;
  await sql`DELETE FROM vehicles WHERE id = ${vehicle}::uuid`;
});

describe('stock workspace', () => {
  it('books cars concurrently even when imports leave the counter behind', async () => {
    await sql`INSERT INTO vehicle_stock_sequences (tenant_id, site_id, prefix, last_number)
      VALUES (${T.tenant}::uuid, ${T.site}::uuid, 'UI', 0)
      ON CONFLICT (tenant_id, site_id) DO UPDATE SET last_number = 0`;
    const input: VehicleFormInput = {
      siteId: T.site, registration: '', vin: '', make: '', model: '', derivative: '', derivativeCandidateCount: '',
      colour: '', fuelType: '', bodyStyle: '', transmission: '', doors: '', engineCc: '', mileage: '', highestMotMileage: '',
      firstRegisteredOn: '', motExpiresOn: '', formerKeepers: '', purchaseSource: '', purchaseDate: '', purchasePrice: '',
      retailPrice: '', vatScheme: '', state: 'booked_in', advertHeadline: '', advertDescription: '', notes: 'Test only', acknowledgeMileage: '',
    };
    const results = await Promise.all(['DX26UIA', 'DX26UIB'].map(registration =>
      withSession(session, tx => applyBookIn(tx, session, { ...input, registration }))));
    for (const result of results) { expect(result.ok).toBe(true); if (result.ok) booked.push(result.vehicleId); }
    const rows = await sql`SELECT stock_sequence FROM vehicles WHERE id IN (${booked[0]!}::uuid, ${booked[1]!}::uuid) ORDER BY stock_sequence`;
    expect(Number(rows[0]?.['stock_sequence'])).toBeGreaterThan(897762);
    expect(Number(rows[1]?.['stock_sequence'])).toBe(Number(rows[0]?.['stock_sequence']) + 1);
  });
  it('finds partial and spaced registrations and stock numbers without exposing cost', async () => {
    for (const q of ['ZX26', 'zx26 uit', 'UI-SEARCH']) {
      const page = await loadStock(session, { q }, false);
      expect(page.rows.map(r => r.id)).toContain(vehicle);
      expect(page.rows.every(r => r.totalCost === null)).toBe(true);
    }
  });
  it('handles malformed sort and pagination without a query failure', async () => {
    const page = await loadStock(session, { q: 'ZX26', sort: 'unknown' as 'newest', limit: -1, offset: Infinity }, false);
    expect(page.rows).toHaveLength(1);
    expect((await loadStock(session, { q: '!!!' }, false)).rows).toHaveLength(0);
    expect((await loadStockOverview(session)).prep).toBeGreaterThan(0);
  });
  it('serializes concurrent cover changes and audits both changes', async () => {
    const outcomes = await Promise.all([first, second].map(id => updateVehiclePhoto(session, id, { hero: true })));
    expect(outcomes.every(r => r.ok)).toBe(true);
    const [count] = await sql`SELECT count(*)::int AS n FROM vehicle_media WHERE vehicle_id = ${vehicle}::uuid AND is_hero`;
    expect(count?.['n']).toBe(1);
    const [audit] = await sql`SELECT count(*)::int AS n FROM audit_events WHERE resource_id IN (${first}, ${second}) AND action = 'vehicle.photo.hero'`;
    expect(audit?.['n']).toBe(2);
  });
  it('protects disclosure evidence from both unpublishing and withdrawal', async () => {
    await sql`UPDATE vehicle_media SET is_disclosure_evidence = true, shown_to_buyer_at = now() WHERE id = ${first}::uuid`;
    expect((await updateVehiclePhoto(session, first, { published: false })).ok).toBe(false);
    expect((await updateVehiclePhoto(session, first, { withdraw: true })).ok).toBe(false);
    const [photo] = await sql`SELECT published, deleted_at FROM vehicle_media WHERE id = ${first}::uuid`;
    expect(photo?.['published']).toBe(true);
    expect(photo?.['deleted_at']).toBeNull();
  });
  it('denies photo changes to a role without stock update permission', async () => {
    expect((await updateVehiclePhoto({ ...session, roleKey: 'sales_exec', permissions: ['vehicle.read'] }, second, { withdraw: true })).ok).toBe(false);
  });
  it('keeps a live car from losing its last public photograph', async () => {
    await sql`UPDATE vehicle_media SET published = false, is_hero = false, is_disclosure_evidence = false WHERE id = ${first}::uuid`;
    await sql`UPDATE vehicles SET state = 'live' WHERE id = ${vehicle}::uuid`;
    expect((await updateVehiclePhoto(session, second, { published: false })).ok).toBe(false);
    expect((await updateVehiclePhoto(session, second, { withdraw: true })).ok).toBe(false);
    const [photo] = await sql`SELECT published FROM vehicle_media WHERE id = ${second}::uuid`;
    expect(photo?.['published']).toBe(true);
  });
  it('stores a real upload locally, publishes it, and records the audit event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forecourt-stock-test-'));
    const disposable = resolve(root).startsWith(resolve(tmpdir()) + '\\forecourt-stock-test-')
      || resolve(root).startsWith(resolve(tmpdir()) + '/forecourt-stock-test-');
    expect(disposable).toBe(true);
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) vi.stubEnv(key, '');
    vi.stubEnv('MEDIA_LOCAL_ROOT', root);
    resetMediaBackendForTests();
    try {
      const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 220, g: 225, b: 235 } } }).jpeg().toBuffer();
      const result = await addVehiclePhoto(session, vehicle, new File([new Uint8Array(bytes)], 'test.jpg', { type: 'image/jpeg' }), 'other');
      expect(result.ok).toBe(true);
      const [photo] = await sql`SELECT id, storage_key, published, exif_stripped FROM vehicle_media WHERE vehicle_id = ${vehicle}::uuid AND shot = 'other' AND created_by = ${session.userId}::uuid`;
      expect(photo?.['published']).toBe(true);
      expect(photo?.['exif_stripped']).toBe(true);
      const metadata = await sharp(await readFile(join(root, String(photo?.['storage_key'])))).metadata();
      expect(metadata.width).toBe(64);
      expect(metadata.exif).toBeUndefined();
      const [audit] = await sql`SELECT action FROM audit_events WHERE resource_id = ${String(photo?.['id'])} AND action = 'vehicle.photo.add'`;
      expect(audit?.['action']).toBe('vehicle.photo.add');
    } finally {
      vi.unstubAllEnvs();
      resetMediaBackendForTests();
      if (disposable) await rm(root, { recursive: true, force: true });
    }
  });
});
