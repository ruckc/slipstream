import { query, command } from '$app/server'
import { db, projectPermissions, users } from '$lib/server/db'
import type { ProjectPermission } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { resolvePermissions } from '$lib/server/permissions'
import type { Permission } from '$lib/server/permissions'
import * as v from 'valibot'

async function assertProjectManage(userId: string, projectId: string): Promise<void> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (userRows.length === 0) throw error(403, 'Forbidden')
  const perms = await resolvePermissions(userRows[0], projectId)
  if (!perms.includes('project:manage')) {
    throw error(403, 'You do not have permission to manage this project')
  }
}

export const getProjectPermissions = query(
  v.object({ actorUserId: v.string(), projectId: v.string() }),
  async (arg: { actorUserId: string; projectId: string }): Promise<ProjectPermission[]> => {
    await assertProjectManage(arg.actorUserId, arg.projectId)
    return db
      .select()
      .from(projectPermissions)
      .where(eq(projectPermissions.projectId, arg.projectId))
  }
)

const permissionLiteral = v.union([
  v.literal('files:read'),
  v.literal('files:write'),
  v.literal('shell'),
  v.literal('project:manage'),
])

export const setProjectPermissions = command(
  v.object({
    actorUserId: v.string(),
    projectId: v.string(),
    grants: v.array(
      v.object({
        principalType: v.union([v.literal('user'), v.literal('org')]),
        principalId: v.string(),
        permissions: v.array(permissionLiteral),
      })
    ),
  }),
  async (arg: {
    actorUserId: string
    projectId: string
    grants: Array<{
      principalType: 'user' | 'org'
      principalId: string
      permissions: Permission[]
    }>
  }): Promise<void> => {
    await assertProjectManage(arg.actorUserId, arg.projectId)

    await db.transaction(async (tx) => {
      await tx.delete(projectPermissions).where(eq(projectPermissions.projectId, arg.projectId))

      if (arg.grants.length > 0) {
        const rows = arg.grants.flatMap((grant) =>
          grant.permissions.map((permission) => ({
            projectId: arg.projectId,
            principalType: grant.principalType,
            principalId: grant.principalId,
            permission,
            grantedBy: arg.actorUserId,
          }))
        )
        if (rows.length > 0) await tx.insert(projectPermissions).values(rows)
      }
    })
  }
)
