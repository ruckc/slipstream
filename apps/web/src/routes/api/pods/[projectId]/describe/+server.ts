import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db, projects } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { resolvePermissions } from '$lib/server/permissions'
import { getCoreV1Api } from '$lib/server/k8s/client'

function projectK8sNamespace(projectId: string): string {
  return `project-${projectId}`
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401, 'Unauthorized')

  const rows = await db.select().from(projects).where(eq(projects.id, params.projectId)).limit(1)

  if (rows.length === 0) error(404, 'Project not found')
  const project = rows[0]

  const permissions = await resolvePermissions(locals.user, project.id)
  if (permissions.length === 0) error(403, 'Access denied')

  const api = getCoreV1Api()

  try {
    const pods = await api.listNamespacedPod({
      namespace: projectK8sNamespace(project.id),
      labelSelector: `slipstream.io/project-id=${project.id}`,
    })
    const pod = pods.items.find((p) => p.status?.phase === 'Running') ?? pods.items[0] ?? null
    return json({ pod })
  } catch {
    return json({ pod: null })
  }
}
