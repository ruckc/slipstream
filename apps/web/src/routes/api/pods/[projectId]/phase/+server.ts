import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { db, projects } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { resolvePermissions } from '$lib/server/permissions'
import { getCoreV1Api } from '$lib/server/k8s/client'
import { getProjectEnvironment, phaseToProjectStatus } from '$lib/server/k8s/cr'

const FAILURE_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'InvalidImageName',
  'CreateContainerConfigError',
  'CreateContainerError',
  'OOMKilled',
  'Error',
])

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401, 'Unauthorized')

  const rows = await db.select().from(projects).where(eq(projects.id, params.projectId)).limit(1)
  if (rows.length === 0) error(404, 'Project not found')

  const permissions = await resolvePermissions(locals.user, rows[0].id)
  if (permissions.length === 0) error(403, 'Access denied')

  const cr = await getProjectEnvironment(params.projectId).catch(() => null)
  const phase = phaseToProjectStatus(cr?.status?.phase)

  if (phase === 'running') {
    return json({ phase: 'running' })
  }

  let failureReason: string | null = null

  if (phase === 'starting' || cr?.status?.phase === 'Error') {
    const api = getCoreV1Api()
    const pods = await api
      .listNamespacedPod({ namespace: `project-${params.projectId}` })
      .catch(() => null)

    if (pods) {
      outer: for (const pod of pods.items) {
        for (const cs of [
          ...(pod.status?.containerStatuses ?? []),
          ...(pod.status?.initContainerStatuses ?? []),
        ]) {
          const reason = cs.state?.waiting?.reason ?? cs.state?.terminated?.reason ?? null
          if (reason && FAILURE_REASONS.has(reason)) {
            failureReason = reason
            break outer
          }
        }
      }
    }

    if (cr?.status?.phase === 'Error') {
      failureReason ??= 'Pod failed to start'
    }
  }

  if (failureReason) {
    return json({ phase: 'failed', failureReason })
  }

  return json({ phase })
}
