import { query, getRequestEvent } from '$app/server'
import { redirect, error } from '@sveltejs/kit'
import { getProject } from '$lib/remote/project.remote'
import { resolvePermissions } from '$lib/server/permissions'
import type { Permission } from '$lib/server/permissions'
import { getProjectEnvironment, phaseToProjectStatus } from '$lib/server/k8s/cr'
import * as v from 'valibot'

export const getProjectPage = query(
  v.object({ namespace: v.string(), project: v.string() }),
  async (arg: { namespace: string; project: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const project = await getProject({ namespaceSlug: arg.namespace, projectSlug: arg.project })
    if (!project) error(404, 'Project not found')

    const [permissions, cr] = await Promise.all([
      resolvePermissions(locals.user, project.id) as Promise<Permission[]>,
      getProjectEnvironment(project.id),
    ])
    if (permissions.length === 0) error(403, 'Access denied')

    return {
      project,
      namespace: project.namespace,
      permissions,
      user: locals.user,
      podStatus: phaseToProjectStatus(cr?.status?.phase),
    }
  }
)
