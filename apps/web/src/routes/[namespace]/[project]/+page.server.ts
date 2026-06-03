import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { getProject } from '$lib/remote/project.remote'
import { startProject, stopProject } from '$lib/remote/project.remote'
import { resolvePermissions } from '$lib/server/permissions'

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const project = await getProject({ namespaceSlug: params.namespace, projectSlug: params.project })
  if (!project) throw error(404, 'Project not found')

  const permissions = await resolvePermissions(locals.user, project.id)
  if (permissions.length === 0) throw error(403, 'Access denied')

  return {
    project,
    namespace: project.namespace,
    permissions,
    user: locals.user,
  }
}

export const actions: Actions = {
  start: async ({ locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject({ namespaceSlug: params.namespace, projectSlug: params.project })
    if (!project) throw error(404, 'Project not found')

    await startProject({ actorUserId: locals.user.id, projectId: project.id })
    return { success: true }
  },

  stop: async ({ locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject({ namespaceSlug: params.namespace, projectSlug: params.project })
    if (!project) throw error(404, 'Project not found')

    await stopProject({ actorUserId: locals.user.id, projectId: project.id })
    return { success: true }
  },
}
