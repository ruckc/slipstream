import { query, command, getRequestEvent } from '$app/server'
import { db, projectCommands } from '$lib/server/db'
import type { ProjectCommand } from '$lib/server/db'
import { eq, and, desc } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import * as v from 'valibot'
import { resolvePermissions } from '$lib/server/permissions'
import { db as _db, users } from '$lib/server/db'

async function assertShellPermission(projectId: string): Promise<void> {
  const { locals } = getRequestEvent()
  if (!locals.user) throw error(401, 'Unauthorized')
  const userRows = await _db.select().from(users).where(eq(users.id, locals.user.id)).limit(1)
  if (userRows.length === 0) throw error(403, 'Forbidden')
  const perms = await resolvePermissions(userRows[0], projectId)
  if (!perms.includes('shell')) throw error(403, 'Forbidden')
}

export const getProjectCommands = query(
  v.object({ projectId: v.string() }),
  async (arg: { projectId: string }): Promise<ProjectCommand[]> => {
    await assertShellPermission(arg.projectId)
    return db
      .select()
      .from(projectCommands)
      .where(eq(projectCommands.projectId, arg.projectId))
      .orderBy(desc(projectCommands.createdAt))
  }
)

export const saveProjectCommand = command(
  v.object({ projectId: v.string(), command: v.string(), label: v.optional(v.string()) }),
  async (arg: { projectId: string; command: string; label?: string }): Promise<ProjectCommand> => {
    await assertShellPermission(arg.projectId)

    const existing = await db
      .select()
      .from(projectCommands)
      .where(
        and(eq(projectCommands.projectId, arg.projectId), eq(projectCommands.command, arg.command))
      )
      .limit(1)
    if (existing.length > 0) return existing[0]

    const [row] = await db
      .insert(projectCommands)
      .values({ projectId: arg.projectId, command: arg.command, label: arg.label })
      .returning()
    return row
  }
)

export const deleteProjectCommand = command(
  v.object({ id: v.string(), projectId: v.string() }),
  async (arg: { id: string; projectId: string }): Promise<void> => {
    await assertShellPermission(arg.projectId)
    await db
      .delete(projectCommands)
      .where(and(eq(projectCommands.id, arg.id), eq(projectCommands.projectId, arg.projectId)))
  }
)
