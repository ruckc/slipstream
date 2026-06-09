import { query, getRequestEvent } from '$app/server'
import { redirect } from '@sveltejs/kit'
import { listUserProjects } from '$lib/remote/namespace.remote'
import { listDeploymentStatuses } from '$lib/server/k8s/deployment'

export const getDashboard = query('unchecked', async (_: Record<string, never>) => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const [projects, statuses] = await Promise.all([
    listUserProjects(locals.user.id),
    listDeploymentStatuses(),
  ])

  return {
    projects: projects.map((p) => ({ ...p, status: statuses.get(p.id) ?? 'stopped' })),
    user: locals.user,
  }
})
