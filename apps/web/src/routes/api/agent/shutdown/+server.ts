import { json, error } from '@sveltejs/kit'
import { db, projects, namespaces } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { getPodIP, scaleDeployment } from '$lib/server/k8s/deployment'

export const POST = async ({ request, getClientAddress }) => {
  const body = await request.json()
  const { projectId } = body
  if (!projectId || typeof projectId !== 'string') throw error(400, 'projectId required')

  const rows = await db
    .select({ project: projects, namespace: namespaces })
    .from(projects)
    .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
    .where(eq(projects.id, projectId))
    .limit(1)

  if (rows.length === 0) throw error(404, 'Project not found')
  const { project, namespace } = rows[0]

  const podIP = await getPodIP(namespace.k8sNamespace, projectId)
  const clientIP = getClientAddress()

  if (!podIP || podIP !== clientIP) throw error(403, 'Forbidden')

  await scaleDeployment(namespace.k8sNamespace, projectId, 0)

  if (project.status === 'running' || project.status === 'starting') {
    await db
      .update(projects)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(eq(projects.id, projectId))
  }

  return json({ ok: true })
}
