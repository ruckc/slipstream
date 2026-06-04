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

export const GET = async ({ locals, params, url }) => {
  const denied = assertAdmin(locals)
  if (denied) return denied

  const coreApi = getCoreV1Api()
  const { namespace, pod } = params
  const container = url.searchParams.get('container') ?? undefined
  const tailLines = parseInt(url.searchParams.get('tail') ?? '200', 10)

  const logs = await coreApi.readNamespacedPodLog({
    name: pod,
    namespace,
    container,
    tailLines,
  })

  return new Response(typeof logs === 'string' ? logs : JSON.stringify(logs), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
