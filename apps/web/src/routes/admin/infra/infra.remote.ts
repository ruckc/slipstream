import { query, getRequestEvent } from '$app/server'
import { error } from '@sveltejs/kit'
import { getCoreV1Api, getAppsV1Api } from '$lib/server/k8s/client'

function assertAdmin() {
  const { locals } = getRequestEvent()
  if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden')
}

export const getNamespaces = query(async () => {
  assertAdmin()
  const coreApi = getCoreV1Api()
  const appsApi = getAppsV1Api()

  const nsResult = await coreApi.listNamespace()
  const namespaceNames = nsResult.items
    .map((ns) => ns.metadata?.name)
    .filter((n): n is string => !!n)
    .filter((n) => n === 'slipstream-system' || n.startsWith('u-') || n.startsWith('o-'))
    .sort()

  return Promise.all(
    namespaceNames.map(async (name) => {
      const [deployments, pods] = await Promise.all([
        appsApi
          .listNamespacedDeployment({ namespace: name })
          .then((r) =>
            r.items.map((d) => ({
              name: d.metadata?.name ?? '',
              replicas: d.spec?.replicas ?? 0,
              readyReplicas: d.status?.readyReplicas ?? 0,
            }))
          )
          .catch(() => []),
        coreApi
          .listNamespacedPod({ namespace: name })
          .then((r) =>
            r.items.map((p) => ({
              name: p.metadata?.name ?? '',
              phase: p.status?.phase ?? 'Unknown',
              ready: p.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True',
              restarts:
                p.status?.containerStatuses?.reduce((sum, cs) => sum + cs.restartCount, 0) ?? 0,
            }))
          )
          .catch(() => []),
      ])
      return { name, deployments, pods }
    })
  )
})

export const describePod = query('unchecked', async (arg: { namespace: string; pod: string }) => {
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
    pod: podSpec,
    events: events.items.map((e) => ({
      type: e.type,
      reason: e.reason,
      message: e.message,
      count: e.count,
      firstTime: e.firstTimestamp,
      lastTime: e.lastTimestamp,
    })),
  }
})

export const getPodLogs = query(
  'unchecked',
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
