/**
 * M6b — the vehicle detail page route.
 *
 * A thin wrapper. All markup comes from `renderVehiclePage`, which is a pure
 * function returning HTML — see `src/render/html.ts` for why. The route's job
 * is data loading, caching, and the sold-vehicle redirect.
 */
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { renderVehiclePage } from '../../../../src/render/vdp.js';
import { loadVehicleBySlug, loadSimilarVehicles, loadDealer } from '../../../../src/data/vehicles.js';
import { loadFinanceBlock } from '../../../../src/data/finance.js';
import { resolveSoldVehicle } from '../../../../../../packages/domain/src/seo.js';
import { tags } from '../../../../src/tenant.js';

export const revalidate = 300;          // 5 minutes; a stock change revalidates by tag immediately
export const dynamicParams = true;

interface Params { params: Promise<{ make: string; model: string; slug: string }> }

export async function generateMetadata({ params }: Params) {
  const h = await headers();
  const tenantId = h.get('x-forecourt-tenant')!;
  const { slug } = await params;
  const vehicle = await loadVehicleBySlug(tenantId, slug);
  if (!vehicle) return {};
  // Metadata is emitted inside the rendered HTML; Next needs only the title
  // for its own bookkeeping.
  return { title: vehicle.metaTitle };
}

export default async function VehiclePage({ params }: Params) {
  const h = await headers();
  const tenantId = h.get('x-forecourt-tenant')!;
  const origin = h.get('x-forecourt-origin')!;
  const { slug } = await params;

  const vehicle = await loadVehicleBySlug(tenantId, slug);
  if (!vehicle) notFound();

  // A sold car is a redirect, never a 200 "Sold Out" page.
  if (vehicle.state !== 'live' && vehicle.state !== 'reserved') {
    const target = resolveSoldVehicle(
      { path: `/used-cars/${slug}`, make: vehicle.make, model: vehicle.model, pricePence: vehicle.pricePence },
      await loadSimilarVehicles(tenantId, vehicle),
    );
    if (target.location) redirect(target.location);
    notFound();
  }

  const dealer = await loadDealer(tenantId, origin);
  const html = renderVehiclePage({
    vehicle, dealer,
    media: vehicle.media,
    mot: vehicle.mot,
    provenanceCheckedAt: vehicle.provenanceCheckedAt,
    // M8. `loadFinanceBlock` returns null unless the dealer has an approved,
    // in-date representative example measured against a compliance rule the
    // consultant has signed off — so a payment figure cannot reach this page
    // by accident, and cannot reach it at all before sign-off.
    finance: await loadFinanceBlock(tenantId, vehicle, new Date()),
    theme: dealer.theme,
  });

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export const dynamic = 'force-static';
export const fetchCache = 'default-cache';
export const generateStaticParams = async () => [];
export const revalidateTag = tags;
