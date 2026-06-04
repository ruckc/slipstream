import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { getProject, startProject, stopProject } from '$lib/remote/project.remote'
import { resolvePermissions } from '$lib/server/permissions'

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const project = await getProject({ namespaceSlug: params.namespace, projectSlug: params.project })
  if (!project) throw error(404, 'Project not found')

  const permissions = await resolvePermissions(locals.user, project.id)
  if (permissions.length === 0) throw error(403, 'Access denied')

  // Auto-start when user navigates to a stopped project (if they have manage permission)
  let status = project.status
  let startError: string | null = null
  if (project.status === 'stopped' && permissions.includes('project:manage')) {
    try {
      const started = await startProject({ actorUserId: locals.user.id, projectId: project.id })
      status = started.status
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      startError = msg
    }
  }

  return {
    project: { ...project, status },
    namespace: project.namespace,
    permissions,
    user: locals.user,
    startError,
  }
}

export const actions: Actions = {
  start: async ({ locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: params.namespace,
      projectSlug: params.project,
    })
    if (!project) throw error(404, 'Project not found')

    await startProject({ actorUserId: locals.user.id, projectId: project.id })
    return { success: true }
  },

  stop: async ({ locals, params }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const project = await getProject({
      namespaceSlug: params.namespace,
      projectSlug: params.project,
    })
    if (!project) throw error(404, 'Project not found')

    await stopProject({ actorUserId: locals.user.id, projectId: project.id })
    return { success: true }
  },
}
