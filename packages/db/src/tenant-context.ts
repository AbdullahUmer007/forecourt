/**
 * Layer 1 of tenant isolation: the request context.
 *
 * There is no code path that reaches the database without one of these.
 * A runtime assertion throws if it is missing, and a lint rule flags any
 * direct client usage outside the repository layer.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  readonly kind: 'tenant';
  readonly tenantId: string;
  readonly userId: string;
  readonly siteIds: readonly string[];
  readonly scopeAllSites: boolean;
  readonly permissions: ReadonlySet<string>;
}

/** Platform jobs that legitimately cross tenants must say so explicitly. */
export interface PlatformContext {
  readonly kind: 'platform';
  /** Why this job is allowed to cross the tenant boundary. Logged. */
  readonly reason: string;
  readonly jobName: string;
}

export type RequestContext = TenantContext | PlatformContext;

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);

export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No request context. Every database access must run inside runWithContext(). ' +
        'If this is a platform job crossing tenants, declare a PlatformContext with a reason.',
    );
  }
  return ctx;
}

export function requireTenant(): TenantContext {
  const ctx = requireContext();
  if (ctx.kind !== 'tenant') {
    throw new Error(`Expected a tenant context, got a platform context for job "${ctx.jobName}".`);
  }
  return ctx;
}

export const can = (permission: string): boolean => {
  const ctx = requireContext();
  return ctx.kind === 'platform' || ctx.permissions.has(permission);
};

export function assertCan(permission: string): void {
  if (!can(permission)) {
    throw Object.assign(new Error(`Permission denied: ${permission}`), { code: 'PERMISSION_DENIED', permission });
  }
}

/** SQL executed on every connection checkout. Layer 2. */
export function contextSql(ctx: TenantContext): { text: string; values: unknown[] } {
  return {
    text: 'SELECT set_tenant_context($1::uuid, $2::uuid, $3::uuid[], $4::boolean)',
    values: [ctx.tenantId, ctx.userId, ctx.siteIds, ctx.scopeAllSites],
  };
}
