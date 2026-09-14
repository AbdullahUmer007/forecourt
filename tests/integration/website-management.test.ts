import { countVehicles, facetCounts } from '../../apps/site/src/data/search';
import { parseSearchQuery } from '../../packages/domain/src/search';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from '@/data/db';
import { loadWebsiteSettings, saveWebsiteSettings } from '@/data/website';
import { renderTenantHome } from '../../apps/site/src/data/home';
import { ensureFixtures, session, T } from './fixtures';
const editor = { ...session, roleKey: 'website_editor', permissions: ['website.update'] };
const brand = randomUUID(), live = randomUUID(), hidden = randomUUID();
let original: Record<string, unknown>;
async function form() {
  const settings = await loadWebsiteSettings(editor);
  expect(settings).not.toBeNull();
  const data = new FormData();
  for (const [key, value] of Object.entries(settings!)) if (typeof value === 'string') data.set(key, value);
  return data;
}
beforeAll(async () => {
  await ensureFixtures();
  [original] = await sql`SELECT address, opening_hours, phone, email FROM sites WHERE id = ${T.site}::uuid` as unknown as [Record<string, unknown>];
  await sql`INSERT INTO brands (id, tenant_id, name, is_default) VALUES (${brand}::uuid, ${T.tenant}::uuid, 'Website test', true)`;
  await sql`UPDATE sites SET address = ${sql.json({ line1: 'Existing address', line2: 'Keep this unit', city: 'Oxford' })},
    opening_hours = ${sql.json([{ days: ['Sunday'], opens: '11:00', closes: '15:00' }])} WHERE id = ${T.site}::uuid`;
  for (const [id, state, make] of [[live, 'live', 'PublicPreviewCar'], [hidden, 'in_prep', 'PrivatePreviewCar']]) {
    await sql`INSERT INTO vehicles (id, tenant_id, site_id, stock_sequence, stock_number, registration, make, model, state, retail_price_pence)
      VALUES (${id!}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${id === live ? 991001 : 991002}, ${id!}, ${id === live ? 'WP26PUB' : 'WP26PRI'}, ${make!}, 'Test', ${state!}::vehicle_state, 1234500)`;
  }
  // The preview shows six newest arrivals; this fixture must be a dated arrival.
  await sql`UPDATE vehicles SET live_at=now() WHERE id=${live}::uuid`;
});
afterAll(async () => {
  await sql`UPDATE sites SET address = ${sql.json(original['address'] as never)}, opening_hours = ${sql.json(original['opening_hours'] as never)}, phone = ${original['phone'] as string | null}, email = ${original['email'] as string | null} WHERE id = ${T.site}::uuid`;
  await sql`DELETE FROM vehicles WHERE id IN (${live}::uuid, ${hidden}::uuid)`;
  await sql`DELETE FROM brands WHERE id = ${brand}::uuid`;
});
describe('website management', () => {
  it('previews distinct presets without changing saved settings or exposing private stock', async () => {
    const before = await loadWebsiteSettings(editor);
    const pages = await Promise.all((['classic','studio','compact'] as const).map(theme => renderTenantHome(T.tenant, '', theme)));
    expect(new Set(pages).size).toBe(3);
    for(const page of pages){expect(page).toContain('PublicPreviewCar');expect(page).not.toContain('PrivatePreviewCar');}
    expect(await loadWebsiteSettings(editor)).toEqual(before);
  });
  it('filters punctuation-heavy catalogue derivatives with matching facet counts', async () => {
    await sql`UPDATE vehicles SET derivative='FOCUS IV (HN) 1.2018 · 1.0 EcoBoost · 125 HP' WHERE id=${live}::uuid`;
    const query=parseSearchQuery({}, ['publicpreviewcar','test']).query;
    const facets=await facetCounts(T.tenant,query);
    expect(facets.variant).toHaveLength(1);
    const selected={...query,filters:{...query.filters,variant:[facets.variant![0]!.value]}};
    expect(await countVehicles(T.tenant,selected)).toBe(1);
    expect(await countVehicles(T.tenant,{...selected,filters:{...selected.filters,variant:['missing-variant']}})).toBe(0);
  });
  it('uses public stock for preview and excludes private and other-tenant stock', async () => {
    const html = await renderTenantHome(T.tenant, '');
    expect(html).toContain('PublicPreviewCar'); expect(html).not.toContain('PrivatePreviewCar');
    expect(html).toContain('12,345');
    expect(await renderTenantHome(randomUUID(), '')).not.toContain('PublicPreviewCar');
  });
  it('validates contact details and opening hours before saving', async () => {
    for (const [key, value] of [['email', 'invalid'], ['weekdayOpen', '25:00'], ['saturdayClose', '09:00'], ['homeHeadline', 'x'.repeat(161)]]) {
      const data = await form(); data.set(key!, value!);
      expect((await saveWebsiteSettings(editor, data)).ok).toBe(false);
    }
    expect((await loadWebsiteSettings(editor))?.line1).toBe('Existing address');
  });
  it('preserves Sunday hours and address metadata and renders saved copy', async () => {
    const data = await form(); data.set('homeHeadline', 'A real saved headline'); data.set('line1', 'Updated address');
    expect(await saveWebsiteSettings(editor, data)).toEqual({ ok: true });
    const [site] = await sql`SELECT address, opening_hours FROM sites WHERE id = ${T.site}::uuid`;
    expect(site?.['address']).toMatchObject({ line1: 'Updated address', line2: 'Keep this unit' });
    expect(site?.['opening_hours']).toContainEqual({ days: ['Sunday'], opens: '11:00', closes: '15:00' });
    expect(await renderTenantHome(T.tenant, '')).toContain('A real saved headline');
    const [audit] = await sql`SELECT diff FROM audit_events WHERE resource_id = ${brand} AND action = 'website_updated' ORDER BY occurred_at DESC LIMIT 1`;
    expect(JSON.stringify(audit?.['diff'])).toContain('Existing address');
    expect(JSON.stringify(audit?.['diff'])).toContain('Updated address');
  });
  it('denies missing permission, foreign tenant and restricted site writes', async () => {
    const data = await form();
    expect((await saveWebsiteSettings({ ...editor, permissions: [] }, data)).ok).toBe(false);
    expect((await saveWebsiteSettings({ ...editor, tenantId: randomUUID() }, data)).ok).toBe(false);
    expect((await saveWebsiteSettings({ ...editor, scope: 'my_sites', siteIds: [randomUUID()] }, data)).ok).toBe(false);
  });
  it('saves all seven days, removes closed days and preserves non-hours settings', async () => {
    const data = await form(); data.set('hoursMode', 'weekly');
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    for (const day of days) {
      data.set(`${day}Status`, day === 'Wednesday' ? 'closed' : 'open');
      data.set(`${day}Open`, day === 'Sunday' ? '12:00' : '09:30');
      data.set(`${day}Close`, day === 'Sunday' ? '15:00' : '17:30');
    }
    expect(await saveWebsiteSettings(editor, data)).toEqual({ ok: true });
    const settings = await loadWebsiteSettings(editor);
    expect(settings?.weeklyHours).toHaveLength(7);
    expect(settings?.weeklyHours.find(h => h.day === 'Wednesday')?.open).toBe(false);
    expect(settings?.weeklyHours.find(h => h.day === 'Sunday')).toMatchObject({ open: true, opens: '12:00', closes: '15:00' });
    expect(settings?.line1).toBe('Updated address');
    const [site] = await sql`SELECT opening_hours FROM sites WHERE id=${T.site}::uuid`;
    expect(JSON.stringify(site?.['opening_hours'])).not.toContain('Wednesday');
    const html = await renderTenantHome(T.tenant, '');
    expect(html).toContain('12:00');
    for (const day of days) data.set(`${day}Status`, 'closed');
    expect(await saveWebsiteSettings(editor, data)).toEqual({ ok: true });
    expect((await loadWebsiteSettings(editor))?.weeklyHours.every(h => !h.open)).toBe(true);
    expect(await renderTenantHome(T.tenant, '')).not.toContain('Opens 10am');
  });
  it('rejects incomplete weekly schedules and invalid open periods atomically', async () => {
    const data = await form(); data.set('hoursMode', 'weekly');
    expect((await saveWebsiteSettings(editor, data)).ok).toBe(false);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) data.set(`${day}Status`, 'closed');
    data.set('SundayStatus', 'open'); data.set('SundayOpen', '17:00'); data.set('SundayClose', '09:00');
    expect((await saveWebsiteSettings(editor, data)).ok).toBe(false);
    expect((await loadWebsiteSettings(editor))?.weeklyHours.every(h => !h.open)).toBe(true);
  });

});
