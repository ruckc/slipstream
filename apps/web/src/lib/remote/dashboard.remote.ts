import { query, getRequestEvent } from '$app/server'
import { redirect } from '@sveltejs/kit'
import { listUserProjects } from '$lib/remote/namespace.remote'
import { listProjectEnvironments, phaseToProjectStatus } from '$lib/server/k8s/cr'

export const getDashboard = query(async () => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const [projects, crs] = await Promise.all([
    listUserProjects(locals.user.id),
    listProjectEnvironments(),
  ])

  const statusMap = new Map(
    crs.map((cr) => [cr.spec.projectId, phaseToProjectStatus(cr.status?.phase)])
  )

  return {
    projects: projects.map((p) => ({ ...p, status: statusMap.get(p.id) ?? 'stopped' })),
    user: locals.user,
  }
})
