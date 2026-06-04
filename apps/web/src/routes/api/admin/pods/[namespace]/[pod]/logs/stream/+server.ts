import { getKubeConfig } from '$lib/server/k8s/client'
import * as k8s from '@kubernetes/client-node'
import { PassThrough } from 'stream'

function assertAdmin(locals: App.Locals) {
  if (!locals.user || locals.user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}

export const GET = async ({ locals, params, url, request }) => {
  const denied = assertAdmin(locals)
  if (denied) return denied

  const { namespace, pod } = params
  const container = url.searchParams.get('container') ?? undefined

  const kc = getKubeConfig()
  const log = new k8s.Log(kc)
  const encoder = new TextEncoder()

  const passThrough = new PassThrough()

  const stream = new ReadableStream({
    start(controller) {
      request.signal.addEventListener('abort', () => {
        passThrough.destroy()
        controller.close()
      })

      passThrough.on('data', (chunk: Buffer) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk.toString('utf8'))}\n\n`))
      })
      passThrough.on('end', () => controller.close())
      passThrough.on('error', () => controller.close())

      log
        .log(namespace, pod, container ?? '', passThrough, () => {}, {
          follow: true,
          tailLines: 100,
          pretty: false,
          timestamps: false,
        })
        .catch(() => controller.close())
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
