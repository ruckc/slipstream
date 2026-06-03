import { command } from '$app/server'
import { db, projects, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { resolvePermissions } from '$lib/server/permissions'
import { issueProjectToken } from '$lib/server/jwt/issue'

export const issueToken = command(
  'unchecked',
  async (arg: { userId: string; projectId: string }): Promise<{ token: string; expiresAt: number }> => {
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, arg.projectId))
      .limit(1)
    if (projectRows.length === 0) throw error(404, 'Project not found')

    const project = projectRows[0]
    if (project.status !== 'running') {
      throw error(409, `Project is not running (status: ${project.status})`)
    }

    const userRows = await db.select().from(users).where(eq(users.id, arg.userId)).limit(1)
    if (userRows.length === 0) throw error(403, 'Forbidden')

    const perms = await resolvePermissions(userRows[0], arg.projectId)
    if (perms.length === 0) throw error(403, 'You do not have access to this project')

    return issueProjectToken(arg.userId, arg.projectId, perms, 300)
  }
)
