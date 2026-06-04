import { json } from '@sveltejs/kit'
import { getCoreV1Api, getAppsV1Api } from '$lib/server/k8s/client'

function assertAdmin(locals: App.Locals) {
  if (!locals.user || locals.user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}

export const GET = async ({ locals }) => {
  const denied = assertAdmin(locals)
  if (denied) return denied

  const coreApi = getCoreV1Api()
  const appsApi = getAppsV1Api()

  const nsResult = await coreApi.listNamespace()
  const namespaceNames = nsResult.items
    .map((ns) => ns.metadata?.name)
    .filter((n): n is string => !!n)
    .filter((n) => n === 'slipstream-system' || n.startsWith('u-') || n.startsWith('o-'))
    .sort()

  const namespaces = await Promise.all(
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

  return json(namespaces)
}
