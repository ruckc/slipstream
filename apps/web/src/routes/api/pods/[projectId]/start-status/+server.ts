import { error } from '@sveltejs/kit'
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

  const projectId = params.projectId
  let cancelled = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
        } catch {
          cancelled = true
        }
      }

      while (!cancelled) {
        const cr = await getProjectEnvironment(projectId).catch(() => null)
        const phase = phaseToProjectStatus(cr?.status?.phase)

        if (phase === 'running') {
          send({ phase: 'running' })
          // Give the client a moment to receive the message before the server
          // closes the stream. WebKit fires EOF before the message event when
          // the connection closes immediately after the last chunk.
          await new Promise<void>((r) => setTimeout(r, 200))
          controller.close()
          return
        }

        let failureReason: string | null = null

        if (phase === 'starting' || cr?.status?.phase === 'Error') {
          const api = getCoreV1Api()
          const pods = await api
            .listNamespacedPod({ namespace: `project-${projectId}` })
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
          send({ phase: 'failed', failureReason })
          await new Promise<void>((r) => setTimeout(r, 200))
          controller.close()
          return
        }

        send({ phase })

        await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      }
    },
    cancel() {
      cancelled = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
