/**
 * Staff of this dealership.
 *
 * Users are global; the tenant boundary is the membership. Removing someone
 * here revokes their membership and their sessions. It does not delete the
 * person — they may work for another dealer.
 */

import { randomBytes } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { authorize, SYSTEM_ROLES } from '@forecourt/domain';
import { withSession, type Tx } from './db';
import type { Session } from '@/auth/session';

const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export interface StaffMember {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  roleKey: string | null;
  roleName: string;
  status: string;
  isLastOwner: boolean;
}

export async function listStaff(session: Session): Promise<StaffMember[]> {
  return withSession(session, async (tx) => {
    const rows = await tx`
      SELECT m.id, m.user_id, m.status::text AS status,
             u.email, u.name, r.key::text AS role_key, r.name AS role_name
        FROM tenant_memberships m
        JOIN users u ON u.id = m.user_id
        JOIN roles r ON r.id = m.role_id
       WHERE m.deleted_at IS NULL
       ORDER BY r.is_system DESC, u.name`;

    const owners = rows.filter((r) => r['role_key'] === 'owner' && r['status'] === 'active');
    return rows.map((r) => ({
      membershipId: String(r['id']),
      userId: String(r['user_id']),
      email: String(r['email']),
      name: String(r['name']),
      roleKey: (r['role_key'] as string | null) ?? null,
      roleName: String(r['role_name']),
      status: String(r['status']),
      isLastOwner: r['role_key'] === 'owner' && r['status'] === 'active' && owners.length === 1,
    }));
  });
}

export async function listAssignableRoles(session: Session): Promise<{ key: string; name: string }[]> {
  return withSession(session, async (tx) => {
    const rows = await tx`
      SELECT key::text AS key, name FROM roles
       WHERE is_system AND key IS NOT NULL
       ORDER BY name`;
    return rows.map((r) => ({ key: String(r['key']), name: String(r['name']) }));
  });
}

export type StaffOutcome =
  | { ok: true; password?: string; email?: string }
  | { ok: false; error: string };

export async function inviteStaff(
  session: Session,
  input: { email: string; name: string; roleKey: string },
): Promise<StaffOutcome> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'user.invite');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'A valid email address is required.' };
  }
  if (!name) return { ok: false, error: 'Their name is required.' };
  if (!SYSTEM_ROLES.some((r) => r.key === input.roleKey)) {
    return { ok: false, error: 'Pick one of the system roles.' };
  }

  const password = randomBytes(18).toString('base64url');
  const passwordHash = await argonHash(password, ARGON);

  try {
    await withSession(session, async (tx) => {
      const [role] = await tx<{ id: string }[]>`
        SELECT id FROM roles WHERE key = ${input.roleKey}::system_role`;
      if (!role) throw new Error('That role is not set up for this dealership.');

      const [existing] = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE lower(email) = ${email} AND deleted_at IS NULL`;

      let userId: string;
      if (existing) {
        userId = existing.id;
        const [member] = await tx`
          SELECT id, status::text AS status, deleted_at FROM tenant_memberships
           WHERE user_id = ${userId}::uuid`;
        if (member && member['deleted_at'] === null && member['status'] !== 'removed') {
          throw Object.assign(new Error('They already have a login here.'), { code: 'ALREADY' });
        }
        await tx`
          UPDATE users SET password_hash = ${passwordHash}, name = ${name},
                           failed_login_count = 0, locked_until = NULL, updated_at = now()
           WHERE id = ${userId}::uuid`;
        if (member) {
          await tx`
            UPDATE tenant_memberships
               SET role_id = ${role.id}::uuid, status = 'active',
                   deleted_at = NULL, accepted_at = now(), updated_at = now()
             WHERE id = ${String(member['id'])}::uuid`;
        } else {
          await insertMembership(tx, session, userId, role.id);
        }
      } else {
        const [created] = await tx<{ id: string }[]>`
          INSERT INTO users (email, name, password_hash, status)
          VALUES (${email}, ${name}, ${passwordHash}, 'active')
          RETURNING id`;
        if (!created) throw new Error('The login could not be created.');
        userId = created.id;
        await insertMembership(tx, session, userId, role.id);
      }

      const token = randomBytes(24).toString('hex');
      await tx`
        INSERT INTO invitations (
          tenant_id, email, role_id, token_hash, invited_by, expires_at
        ) VALUES (
          ${session.tenantId}::uuid, ${email}, ${role.id}::uuid,
          ${token}, ${session.userId}::uuid, now() + interval '14 days'
        )`;

      await tx`
        INSERT INTO audit_events (
          tenant_id, actor_type, actor_id, resource_type, resource_id, action, diff
        ) VALUES (
          ${session.tenantId}::uuid, 'user', ${session.userId}::uuid,
          'membership', ${userId}::uuid, 'create',
          ${tx.json({ after: { email, role: input.roleKey } })}
        )`;
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'ALREADY') {
      return { ok: false, error: (err as Error).message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'They could not be invited.' };
  }

  return { ok: true, password, email };
}

async function insertMembership(tx: Tx, session: Session, userId: string, roleId: string) {
  await tx`
    INSERT INTO tenant_memberships (
      tenant_id, user_id, role_id, scope_all_sites, status, invited_by, invited_at, accepted_at
    ) VALUES (
      ${session.tenantId}::uuid, ${userId}::uuid, ${roleId}::uuid,
      true, 'active', ${session.userId}::uuid, now(), now()
    )`;
}

export async function setStaffStatus(
  session: Session,
  membershipId: string,
  next: 'suspended' | 'removed' | 'active',
): Promise<StaffOutcome> {
  const permission = next === 'removed' ? 'user.remove' : 'user.update';
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, permission);
  if (!decision.allowed) return { ok: false, error: decision.reason };

  try {
    await withSession(session, async (tx) => {
      const [row] = await tx<{ user_id: string; role_key: string | null; status: string }[]>`
        SELECT m.user_id, r.key::text AS role_key, m.status::text AS status
          FROM tenant_memberships m
          JOIN roles r ON r.id = m.role_id
         WHERE m.id = ${membershipId}::uuid AND m.deleted_at IS NULL`;
      if (!row) throw new Error('That person is not on this dealership.');

      if (row.role_key === 'owner' && next !== 'active') {
        const owners = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM tenant_memberships m
            JOIN roles r ON r.id = m.role_id
           WHERE r.key = 'owner' AND m.status = 'active' AND m.deleted_at IS NULL`;
        if ((owners[0]?.n ?? 0) <= 1) {
          throw new Error('The last owner cannot be removed. Promote someone else first.');
        }
      }

      await tx`
        UPDATE tenant_memberships
           SET status = ${next}::membership_status,
               deleted_at = ${next === 'removed' ? new Date() : null},
               updated_at = now()
         WHERE id = ${membershipId}::uuid`;

      if (next !== 'active') {
        await tx`
          UPDATE sessions SET revoked_at = now()
           WHERE user_id = ${row.user_id}::uuid
             AND tenant_id = ${session.tenantId}::uuid
             AND revoked_at IS NULL`;
      }

      await tx`
        INSERT INTO audit_events (
          tenant_id, actor_type, actor_id, resource_type, resource_id, action, diff
        ) VALUES (
          ${session.tenantId}::uuid, 'user', ${session.userId}::uuid,
          'membership', ${membershipId}::uuid, 'update',
          ${tx.json({ after: { status: next } })}
        )`;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That change could not be made.' };
  }
  return { ok: true };
}
