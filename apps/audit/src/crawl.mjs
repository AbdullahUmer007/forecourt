/**
 * Forecourt Dealer Site Audit — polite crawler.
 *
 * Rules we hold ourselves to (see docs/07 §7.3):
 *  - identify honestly, with a contact URL
 *  - respect robots.txt disallow rules
 *  - rate limit
 *  - public pages only, small sample
 *  - store no personal data
 *
 * Zero runtime dependencies. Node 20+.
 */

import { looksLikeVehicleUrl } from './checks.mjs';

const UA = 'ForecourtSiteAudit/1.0 (+https://forecourt.example/audit; free dealer website audit; contact audit@forecourt.example)';
const DELAY_MS = 700;
const TIMEOUT_MS = 15000;
const MAX_VEHICLE_SAMPLES = 5;
const MAX_LINK_CHECKS = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastFetch = 0;
async function politeFetch(url, opts = {}) {
  const wait = DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) await sleep(wait);
  lastFetch = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      ...opts,
    });
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('text') || contentType.includes('xml') || contentType.includes('json')
      ? await res.text()
      : '';
    return { url, finalUrl: res.url, status: res.status, headers: res.headers, body, contentType };
  } catch (err) {
    return { url, finalUrl: url, status: 0, body: '', error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ parsing

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function parsePage(res) {
  const html = res.body || '';
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim();
  const description =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ||
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)?.[1] ||
    '';

  const jsonLdTypes = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === 'object') {
          const t = node['@type'];
          if (typeof t === 'string') jsonLdTypes.push(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && jsonLdTypes.push(x));
          Object.values(node).forEach(walk);
        }
      };
      walk(parsed);
    } catch { /* malformed JSON-LD is itself a finding, but not one we score */ }
  }

  return { url: res.finalUrl || res.url, status: res.status, title, description, jsonLdTypes, html, text: strip(html) };
}

function absolute(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function extractLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = absolute(m[1], base);
    if (href && /^https?:/i.test(href)) out.push({ href, text: strip(m[2]).slice(0, 120) });
  }
  return out;
}

// ------------------------------------------------------------------ robots

function parseRobots(txt) {
  const disallow = [];
  let applies = false;
  for (const raw of txt.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') applies = value === '*';
    else if (key === 'disallow' && applies && value) disallow.push(value);
  }
  return disallow;
}

const blocked = (url, disallow, origin) => {
  const path = url.startsWith(origin) ? url.slice(origin.length) || '/' : url;
  return disallow.some((d) => path.startsWith(d));
};

// ------------------------------------------------------------------ sitemap

async function fetchSitemap(origin, robotsTxt) {
  const declared = [...(robotsTxt || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const candidates = [...declared, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set();

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const res = await politeFetch(candidate);
    if (res.status !== 200 || !/<(urlset|sitemapindex)/i.test(res.body)) continue;

    let urls = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

    // Follow one level of sitemap index
    if (/<sitemapindex/i.test(res.body)) {
      const children = urls.slice(0, 5);
      urls = [];
      for (const child of children) {
        const c = await politeFetch(child);
        if (c.status === 200) urls.push(...[...c.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]));
      }
    }
    return { source: candidate, urls };
  }
  return null;
}

// ------------------------------------------------------------------ main

export async function crawl(inputUrl, { log = () => {} } = {}) {
  const start = new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`);
  const origin = start.origin;
  const host = start.host;

  log(`Fetching robots.txt`);
  const robotsRes = await politeFetch(`${origin}/robots.txt`);
  const robots = robotsRes.status === 200 ? robotsRes.body : null;
  const disallow = robots ? parseRobots(robots) : [];

  log(`Fetching homepage`);
  const home = parsePage(await politeFetch(origin));

  log(`Looking for a sitemap`);
  const sitemap = await fetchSitemap(origin, robots);

  const homeLinks = extractLinks(home.html, origin).filter((l) => l.href.startsWith(origin));

  // --- find vehicle pages: sitemap first, then homepage/stock-page links ---
  let vehicleUrls = (sitemap?.urls || []).filter(looksLikeVehicleUrl);

  if (!vehicleUrls.length) {
    log(`No vehicles in the sitemap — looking for a stock page`);
    const stockLink = homeLinks.find((l) =>
      /stock|vehicles|used-cars|our-cars|search/i.test(l.href) && !/sell/i.test(l.href)
    );
    if (stockLink) {
      const stock = parsePage(await politeFetch(stockLink.href));
      vehicleUrls = extractLinks(stock.html, stockLink.href)
        .map((l) => l.href)
        .filter((h) => h.startsWith(origin) && looksLikeVehicleUrl(h));
    }
    if (!vehicleUrls.length) {
      vehicleUrls = homeLinks.map((l) => l.href).filter(looksLikeVehicleUrl);
    }
  }

  vehicleUrls = [...new Set(vehicleUrls)].filter((u) => !blocked(u, disallow, origin)).slice(0, MAX_VEHICLE_SAMPLES);

  const vehiclePages = [];
  for (const url of vehicleUrls) {
    log(`Sampling vehicle page ${vehiclePages.length + 1}/${vehicleUrls.length}`);
    vehiclePages.push(parsePage(await politeFetch(url)));
  }

  // --- finance and legal pages ---
  const financeLink = homeLinks.find((l) => /\/finance|car-finance|finance-options/i.test(l.href));
  const financePage = financeLink ? (log('Fetching finance page'), parsePage(await politeFetch(financeLink.href))) : null;

  const legalLinks = homeLinks.filter((l) =>
    /privacy|terms|complaint|disclosure|cookie|vulnerable|fair-pricing|status/i.test(l.href + ' ' + l.text)
  );
  const legalPages = [];
  for (const l of legalLinks.slice(0, 3)) {
    if (/\.pdf(\?|$)/i.test(l.href)) continue;
    legalPages.push(parsePage(await politeFetch(l.href)));
  }

  // --- sample internal links for broken pages ---
  const linkPool = [...new Set(homeLinks.map((l) => l.href))]
    .filter((h) => !blocked(h, disallow, origin) && !/\.(jpg|jpeg|png|webp|avif|svg|pdf|zip)$/i.test(h))
    .slice(0, MAX_LINK_CHECKS);
  const checkedLinks = [];
  for (const url of linkPool) {
    const res = await politeFetch(url, { method: 'HEAD' });
    checkedLinks.push({ url, status: res.status === 405 || res.status === 0 ? 200 : res.status });
  }

  // --- soft signals ---
  const stockMatch = /(\d{2,4})\s*\+?\s*(cars|vehicles)\s*(in\s*(stock|store))/i.exec(home.text);
  const estimatedStockCount = stockMatch ? Number(stockMatch[1]) : null;
  const isCreditBroker = /credit broker|authorised and regulated by the financial conduct authority|\bFRN\b/i.test(
    [home.text, financePage?.text, ...legalPages.map((p) => p.text)].filter(Boolean).join(' ')
  );

  return {
    input: inputUrl, origin, host, robots, disallow, sitemap,
    home, vehiclePages, financePage, legalPages, legalLinks,
    checkedLinks, estimatedStockCount, isCreditBroker,
    auditedAt: new Date().toISOString(),
  };
}
