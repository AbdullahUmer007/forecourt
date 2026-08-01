#!/usr/bin/env node
/**
 * Forecourt Dealer Site Audit
 *
 *   node apps/audit/src/index.mjs <domain> [--out report.md] [--json report.json]
 *
 * Zero runtime dependencies. Node 20+.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { crawl } from './crawl.mjs';
import { CHECKS, score } from './checks.mjs';

const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌', skip: '—' };
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const fixture = flag('fixture');

if (!target && !fixture) {
  console.error('Usage: node apps/audit/src/index.mjs <domain> [--out report.md] [--json report.json]');
  console.error('       node apps/audit/src/index.mjs --fixture fixtures/<name>.json');
  process.exit(1);
}

const log = (m) => process.stderr.write(`  … ${m}\n`);

// --fixture replays a saved crawl. Used for CI regression tests, and for any
// environment where outbound network access to the target is unavailable.
console.error(`\nForecourt Dealer Site Audit — ${fixture ? `fixture: ${fixture}` : target}\n`);
const site = fixture ? JSON.parse(readFileSync(fixture, 'utf8')) : await crawl(target, { log });

const results = CHECKS.map((c) => {
  try {
    return c.run(site);
  } catch (err) {
    return { id: c.id, title: c.id, weight: 0, status: 'skip', finding: `Check errored: ${err.message}` };
  }
});

const total = score(results);
const failed = results.filter((r) => r.status === 'fail');
const warned = results.filter((r) => r.status === 'warn');
const passed = results.filter((r) => r.status === 'pass');

// ------------------------------------------------------------------ console

console.error('');
for (const r of results) {
  console.error(`${ICON[r.status]} ${r.title}`);
  console.error(`    ${r.finding}`);
}
console.error(`\n  SCORE: ${total}/100   (${passed.length} passed · ${warned.length} warnings · ${failed.length} failed)\n`);

// ------------------------------------------------------------------ report

const band =
  total >= 85 ? 'Strong. A few refinements rather than repairs.'
  : total >= 65 ? 'Reasonable foundations with meaningful gaps.'
  : total >= 40 ? 'Significant problems that are costing this dealer enquiries.'
  : 'Serious structural problems. Stock is largely invisible to search.';

const stock = site.estimatedStockCount ? `around ${site.estimatedStockCount} cars` : 'their stock';
const vehicleUrlCount = (site.sitemap?.urls || []).length;

const md = `# Website audit — ${site.host}

**Audited:** ${new Date(site.auditedAt).toUTCString()}
**Score:** ${total}/100 — ${band}
**Checks:** ${passed.length} passed · ${warned.length} warnings · ${failed.length} failed

---

## Before you read this

This is a free, unsolicited audit. We build software for independent dealers and we audit dealer websites across the UK. Yours came up, so we ran it properly.

**You don't need us to fix any of this.** Everything below can be handed to your current website supplier, and they should be able to fix most of it. Ask them.

Everything here is checkable — the URLs are included, and you can verify any of it in a browser in about ten minutes. We'd encourage you to.

---

## Summary

| Check | Result |
|---|---|
${results.map((r) => `| ${r.title} | ${ICON[r.status].trim()} ${r.status === 'pass' ? 'Pass' : r.status === 'warn' ? 'Needs attention' : r.status === 'fail' ? 'Failing' : 'Not applicable'} |`).join('\n')}

---

## What's costing you the most

${failed.length === 0 ? '_Nothing is outright failing — see the warnings below._' : failed
  .sort((a, b) => b.weight - a.weight)
  .map((r, i) => `### ${i + 1}. ${r.title}

**What we found.** ${r.finding}

**Why it matters.** ${r.impact}

**What should be happening.** ${r.fix}
`).join('\n')}

${warned.length ? `---

## Worth fixing

${warned.sort((a, b) => b.weight - a.weight).map((r) => `### ${r.title}

${r.finding}

${r.impact ? `${r.impact}\n\n` : ''}${r.fix ? `**Fix:** ${r.fix}` : ''}
`).join('\n')}` : ''}

${passed.length ? `---

## What's working

It would be a poor audit that only found problems.

${passed.map((r) => `- **${r.title}.** ${r.finding}`).join('\n')}` : ''}

---

## What we looked at

| | |
|---|---|
| Homepage | ${site.home?.status === 200 ? 'fetched' : `status ${site.home?.status}`} |
| Sitemap | ${site.sitemap ? `${vehicleUrlCount} URLs from ${site.sitemap.source}` : 'not found'} |
| Vehicle pages sampled | ${site.vehiclePages.length} |
| Finance page | ${site.financePage ? 'fetched' : 'not found'} |
| Legal / compliance links | ${site.legalLinks.length} |
| Internal links checked | ${site.checkedLinks.length} |
| Stock advertised on site | ${site.estimatedStockCount ?? 'not stated'} |

---

## Notes

- Verified against the live site on the date above at the URLs given. Websites change; if something here has since been fixed, good.
- We assessed only what is publicly visible. We have no access to analytics, stock systems or commercial data, so any financial estimate is labelled as an assumption — those numbers are yours to check, not ours to assert.
- Page speed and Core Web Vitals were not measured here; that needs a rendering test. Worth a PageSpeed Insights check.
- Our crawler identifies itself, respects robots.txt, rate-limits, reads only public pages, and stores no personal data.
- This is a technical and commercial assessment. It is not legal or regulatory advice. Finance and compliance observations are matters for your own compliance adviser.

---

*Prepared by Forecourt — software for independent used-car dealers.*
`;

const outPath = flag('out') || `audit-${site.host.replace(/[^a-z0-9]/gi, '-')}.md`;
writeFileSync(outPath, md);
console.error(`  Report written to ${outPath}`);

if (flag('json')) {
  writeFileSync(flag('json'), JSON.stringify({ host: site.host, auditedAt: site.auditedAt, score: total, results }, null, 2));
  console.error(`  JSON written to ${flag('json')}`);
}

process.stdout.write(`${total}\n`);
