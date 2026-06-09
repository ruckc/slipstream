import { command, getRequestEvent } from '$app/server'
import { db, namespaces, projects, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { resolvePermissions } from '$lib/server/permissions'
import { issueProjectToken } from '$lib/server/jwt/issue'
import { getDeploymentStatus } from '$lib/server/k8s/deployment'

export const issueToken = command(
  'unchecked',
  async (arg: { projectId: string }): Promise<{ token: string; expiresAt: number }> => {
    const { locals } = getRequestEvent()
    if (!locals.user) throw error(401, 'Unauthorized')
    const userId = locals.user.id

    const rows = await db
      .select({ project: projects, namespace: namespaces })
      .from(projects)
      .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
      .where(eq(projects.id, arg.projectId))
      .limit(1)
    if (rows.length === 0) throw error(404, 'Project not found')

    const { namespace } = rows[0]
    const podStatus = await getDeploymentStatus(namespace.k8sNamespace, arg.projectId)
    if (podStatus !== 'running') {
      throw error(409, 'Project is not running')
    }

    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (userRows.length === 0) throw error(403, 'Forbidden')

    const perms = await resolvePermissions(userRows[0], arg.projectId)
    if (perms.length === 0) throw error(403, 'You do not have access to this project')

    return issueProjectToken(userId, arg.projectId, perms, 300)
  }
)
