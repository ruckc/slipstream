import { db, projects, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { resolvePermissions } from '$lib/server/permissions'
import { issueProjectToken } from '$lib/server/jwt/issue'

export async function issueToken(
  userId: string,
  projectId: string
): Promise<{ token: string; expiresAt: number }> {
  // 1. Load project and verify it exists and is running
  const projectRows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)

  if (projectRows.length === 0) {
    throw error(404, 'Project not found')
  }

  const project = projectRows[0]

  if (project.status !== 'running') {
    throw error(409, `Project is not running (status: ${project.status})`)
  }

  // 2. Load user and resolve permissions
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)

  if (userRows.length === 0) {
    throw error(403, 'Forbidden')
  }

  const perms = await resolvePermissions(userRows[0], projectId)

  // 3. If no permissions at all, deny
  if (perms.length === 0) {
    throw error(403, 'You do not have access to this project')
  }

  // 4. Issue JWT with 5-minute TTL
  return issueProjectToken(userId, projectId, perms, 300)
}
