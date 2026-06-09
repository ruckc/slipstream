const VM_URL = process.env.METRICS_PUSH_URL?.replace(/\/+$/, '') ?? ''

/**
 * Instant query against VictoriaMetrics.
 * Returns a map of project_id label value → numeric metric value.
 * Returns an empty map if VictoriaMetrics is not configured or unreachable.
 */
export async function queryMetricByProject(metricName: string): Promise<Map<string, number>> {
  if (!VM_URL) return new Map()

  const url = `${VM_URL}/api/v1/query?query=${encodeURIComponent(metricName)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return new Map()

    const body = (await res.json()) as {
      status: string
      data: {
        resultType: string
        result: Array<{ metric: Record<string, string>; value: [number, string] }>
      }
    }
    if (body.status !== 'success') return new Map()

    const map = new Map<string, number>()
    for (const item of body.data.result) {
      const projectId = item.metric['project_id']
      if (projectId) map.set(projectId, parseFloat(item.value[1]))
    }
    return map
  } catch {
    return new Map()
  }
}
