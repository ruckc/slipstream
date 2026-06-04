import { json } from '@sveltejs/kit'
import { getCoreV1Api } from '$lib/server/k8s/client'

function assertAdmin(locals: App.Locals) {
  if (!locals.user || locals.user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}

export const GET = async ({ locals, params }) => {
  const denied = assertAdmin(locals)
  if (denied) return denied

  const coreApi = getCoreV1Api()
  const { namespace, pod } = params

  const [podSpec, events] = await Promise.all([
    coreApi.readNamespacedPod({ name: pod, namespace }),
    coreApi.listNamespacedEvent({
      namespace,
      fieldSelector: `involvedObject.name=${pod}`,
    }),
  ])

  return json({
    pod: podSpec,
    events: events.items.map((e) => ({
      type: e.type,
      reason: e.reason,
      message: e.message,
      count: e.count,
      firstTime: e.firstTimestamp,
      lastTime: e.lastTimestamp,
    })),
  })
}
