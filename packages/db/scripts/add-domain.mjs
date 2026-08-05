/**
 * Point a hostname at a dealer's public site.
 *
 *   pnpm db:domain forecourt-site.up.railway.app
 *   pnpm db:domain kenningtoncarsales.co.uk --tenant "Kennington Car Sales"
 *   pnpm db:domain preview.example.com --unverify
 *
 * Why a script rather than a row somebody pastes in: `apps/site` resolves a
 * request to a tenant by its Host header and **404s an unknown or unverified
 * host**, deliberately and without a fallback — falling through to a default
 * tenant would serve one dealer's stock under another dealer's domain. So a
 * freshly deployed site returns 404 to everything until a hostname is
 * registered, and that is correct behaviour rather than a broken deployment.
 *
 * `verified_at` is what the DNS TXT challenge sets in the real flow. Setting it
 * here is a deliberate shortcut for a host we control — a Railway subdomain, a
 * staging name — and the script says so on every run, because marking somebody
 * else's domain verified without the challenge is precisely the impersonation
 * the check exists to prevent.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const args = process.argv.slice(2);
const hostname = args.find((a) => !a.startsWith('--'));
const tenantArg = args.find((a) => a.startsWith('--tenant='))?.split('=').slice(1).join('=')
  ?? (args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : undefined);
const UNVERIFY = args.includes('--unverify');

if (!hostname) {
  console.error(
    'Usage: pnpm db:domain <hostname> [--tenant "<dealer name>"] [--unverify]\n\n' +
    '  <hostname>   the host the public site will be reached on, no scheme and no port\n' +
    '  --tenant     which dealer it belongs to; defaults to the only one if there is\n' +
    '               exactly one, and refuses to guess if there is more than one\n' +
    '  --unverify   register it but leave it unverified, so it still 404s\n',
  );
  process.exit(1);
}

const host = hostname.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
if (!/^[a-z0-9.-]+$/.test(host)) {
  console.error(`"${hostname}" does not look like a hostname.`);
  process.exit(1);
}

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

try {
  const tenants = tenantArg
    ? await sql`SELECT id, name FROM tenants WHERE name = ${tenantArg} AND deleted_at IS NULL`
    : await sql`SELECT id, name FROM tenants WHERE deleted_at IS NULL ORDER BY created_at`;

  if (tenants.length === 0) {
    console.error(tenantArg
      ? `No tenant called "${tenantArg}". Run pnpm db:seed to create the demo dealership.`
      : 'There are no tenants in this database yet. Run pnpm db:seed first.');
    process.exit(1);
  }
  // Refuses to guess, for the same reason the resolver refuses to fall
  // through: attaching a hostname to the wrong dealer is a data leak wearing a
  // configuration mistake.
  if (tenants.length > 1 && !tenantArg) {
    console.error(
      `There are ${tenants.length} tenants and no --tenant given. Name one:\n  ` +
      tenants.map((t) => `--tenant "${t.name}"`).join('\n  '),
    );
    process.exit(1);
  }

  const tenant = tenants[0];
  const [brand] = await sql`
    SELECT id FROM brands WHERE tenant_id = ${tenant.id}::uuid ORDER BY created_at LIMIT 1`;
  if (!brand) {
    console.error(`"${tenant.name}" has no brand, so there is nothing to render. Run pnpm db:seed.`);
    process.exit(1);
  }

  const verifiedAt = UNVERIFY ? null : new Date();

  const [row] = await sql`
    INSERT INTO domains (tenant_id, brand_id, hostname, is_primary,
                         verification_token, verified_at, ssl_status)
    VALUES (${tenant.id}::uuid, ${brand.id}::uuid, ${host},
            NOT EXISTS (SELECT 1 FROM domains WHERE tenant_id = ${tenant.id}::uuid AND is_primary),
            ${'deploy-' + host}, ${verifiedAt}, 'active')
    ON CONFLICT (lower(hostname)) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          brand_id  = EXCLUDED.brand_id,
          verified_at = EXCLUDED.verified_at,
          updated_at = now()
    RETURNING hostname, is_primary, verified_at`;

  console.log(`${row.hostname} → ${tenant.name}${row.is_primary ? ' (primary)' : ''}`);
  console.log(row.verified_at
    ? '  Verified. The site will serve on this host.\n' +
      '  NOTE: marked verified without the DNS TXT challenge. Only ever do that for a\n' +
      '  host you control — the challenge is what stops somebody pointing a CNAME at us\n' +
      '  and impersonating a dealer on a domain they do not own.'
    : '  Left UNVERIFIED, so the site will still 404 on it. Re-run without --unverify to serve.');
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
