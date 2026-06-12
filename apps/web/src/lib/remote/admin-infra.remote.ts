import { query, getRequestEvent } from '$app/server'
import { error } from '@sveltejs/kit'
import { getCoreV1Api } from '$lib/server/k8s/client'
import { listProjectEnvironments } from '$lib/server/k8s/cr'
import * as v from 'valibot'

function assertAdmin() {
  const { locals } = getRequestEvent()
  if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden')
}

export const getNamespaces = query(async () => {
  assertAdmin()
  const coreApi = getCoreV1Api()

  const envs = await listProjectEnvironments()
  const projectNamespaces = [...new Set(envs.map((e) => `project-${e.spec.projectId}`))].sort()

  const releaseNamespace = process.env.WEB_NAMESPACE
  const namespaceNames = [...(releaseNamespace ? [releaseNamespace] : []), ...projectNamespaces]

  return Promise.all(
    namespaceNames.map(async (name) => {
      const pods = await coreApi
        .listNamespacedPod({ namespace: name })
        .then((r) =>
          r.items.map((p) => ({
            name: p.metadata?.name ?? '',
            phase: p.status?.phase ?? 'Unknown',
            ready: p.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True',
            restarts:
              p.status?.containerStatuses?.reduce((sum, cs) => sum + cs.restartCount, 0) ?? 0,
            containers: p.spec?.containers?.map((c) => c.name) ?? [],
          }))
        )
        .catch(() => [])
      return { name, pods }
    })
  )
})

export const describePod = query(
  v.object({ namespace: v.string(), pod: v.string() }),
  async (arg: { namespace: string; pod: string }) => {
    assertAdmin()
    const coreApi = getCoreV1Api()
    const [podSpec, events] = await Promise.all([
      coreApi.readNamespacedPod({ name: arg.pod, namespace: arg.namespace }),
      coreApi.listNamespacedEvent({
        namespace: arg.namespace,
        fieldSelector: `involvedObject.name=${arg.pod}`,
      }),
    ])
    return {
      pod: JSON.parse(JSON.stringify(podSpec)),
      events: events.items.map((e) => ({
        type: e.type,
        reason: e.reason,
        message: e.message,
        count: e.count,
        firstTime: e.firstTimestamp,
        lastTime: e.lastTimestamp,
      })),
    }
  }
)

export const getPodLogs = query(
  v.object({
    namespace: v.string(),
    pod: v.string(),
    container: v.optional(v.string()),
    tail: v.optional(v.number()),
  }),
  async (arg: { namespace: string; pod: string; container?: string; tail?: number }) => {
    assertAdmin()
    const coreApi = getCoreV1Api()
    const logs = await coreApi.readNamespacedPodLog({
      name: arg.pod,
      namespace: arg.namespace,
      container: arg.container,
      tailLines: arg.tail ?? 200,
    })
    return typeof logs === 'string' ? logs : JSON.stringify(logs)
  }
)
