import { query, getRequestEvent } from '$app/server'
import { redirect, error } from '@sveltejs/kit'
import { getProject } from '$lib/remote/project.remote'
import { resolvePermissions } from '$lib/server/permissions'
import { db, networkFlows } from '$lib/server/db'
import { eq, desc } from 'drizzle-orm'

const PAGE_SIZE = 100

export const getNetworkActivity = query(
  'unchecked',
  async (arg: { namespace: string; project: string; before?: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({ namespaceSlug: arg.namespace, projectSlug: arg.project })
    if (!project) error(404, 'Project not found')

    const permissions = await resolvePermissions(locals.user, project.id)
    if (permissions.length === 0) error(403, 'Access denied')

    const flows = await db
      .select()
      .from(networkFlows)
      .where(eq(networkFlows.projectId, project.id))
      .orderBy(desc(networkFlows.observedAt))
      .limit(PAGE_SIZE)

    return {
      project,
      namespace: project.namespace,
      flows,
    }
  }
)
