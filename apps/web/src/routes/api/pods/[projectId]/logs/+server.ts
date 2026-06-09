import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db, projects } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { resolvePermissions } from '$lib/server/permissions'
import { getCoreV1Api } from '$lib/server/k8s/client'
import { projectK8sNamespace } from '$lib/server/k8s/namespace'

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401, 'Unauthorized')

  const rows = await db.select().from(projects).where(eq(projects.id, params.projectId)).limit(1)

  if (rows.length === 0) error(404, 'Project not found')
  const project = rows[0]

  const permissions = await resolvePermissions(locals.user, project.id)
  if (permissions.length === 0) error(403, 'Access denied')

  const api = getCoreV1Api()
  const k8sNs = projectK8sNamespace(project.id)

  try {
    const pods = await api.listNamespacedPod({
      namespace: k8sNs,
      labelSelector: `slipstream.io/project=${project.id}`,
    })
    const pod = pods.items.find((p) => p.status?.phase === 'Running') ?? pods.items[0]
    if (!pod?.metadata?.name) return json({ logs: '' })
    const logs = await api.readNamespacedPodLog({
      name: pod.metadata.name,
      namespace: k8sNs,
      container: 'agent',
      tailLines: 1000,
    })
    return json({ logs: logs ?? '' })
  } catch {
    return json({ logs: '' })
  }
}
