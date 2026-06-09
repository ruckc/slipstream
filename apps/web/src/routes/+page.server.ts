import { redirect } from '@sveltejs/kit'
import { listUserProjects } from '$lib/remote/namespace.remote'
import { listDeploymentStatuses } from '$lib/server/k8s/deployment'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const [projects, statuses] = await Promise.all([
    listUserProjects(locals.user.id),
    listDeploymentStatuses(),
  ])

  return {
    projects: projects.map((p) => ({ ...p, status: statuses.get(p.id) ?? 'stopped' })),
    user: locals.user,
  }
}
