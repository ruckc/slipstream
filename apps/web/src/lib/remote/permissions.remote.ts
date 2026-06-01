import { db, projectPermissions, users } from '$lib/server/db'
import type { ProjectPermission } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { resolvePermissions } from '$lib/server/permissions'
import type { Permission } from '$lib/server/permissions'

export async function getProjectPermissions(
  actorUserId: string,
  projectId: string,
): Promise<ProjectPermission[]> {
  await assertProjectManage(actorUserId, projectId)

  return db
    .select()
    .from(projectPermissions)
    .where(eq(projectPermissions.projectId, projectId))
}

export async function setProjectPermissions(
  actorUserId: string,
  projectId: string,
  grants: Array<{
    principalType: 'user' | 'org'
    principalId: string
    permissions: Permission[]
  }>,
): Promise<void> {
  await assertProjectManage(actorUserId, projectId)

  // Replace all permissions for this project in a transaction
  await db.transaction(async (tx) => {
    // Delete all existing permissions
    await tx
      .delete(projectPermissions)
      .where(eq(projectPermissions.projectId, projectId))

    // Insert new grants (one row per permission per principal)
    if (grants.length > 0) {
      const rows = grants.flatMap((grant) =>
        grant.permissions.map((permission) => ({
          projectId,
          principalType: grant.principalType,
          principalId: grant.principalId,
          permission,
          grantedBy: actorUserId,
        })),
      )

      if (rows.length > 0) {
        await tx.insert(projectPermissions).values(rows)
      }
    }
  })
}

async function assertProjectManage(userId: string, projectId: string): Promise<void> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (userRows.length === 0) throw error(403, 'Forbidden')

  const perms = await resolvePermissions(userRows[0], projectId)
  if (!perms.includes('project:manage')) {
    throw error(403, 'You do not have permission to manage this project')
  }
}
