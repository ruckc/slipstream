function resolveVmUrl(): string {
  const raw = process.env.METRICS_PUSH_URL?.replace(/\/+$/, '') ?? ''
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    if (!parsed.hostname) return ''
  } catch {
    return ''
  }
  return raw
}

const VM_URL = resolveVmUrl()

export type MetricSeries = {
  timestamps: number[]
  values: number[]
}

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

/**
 * Range query against VictoriaMetrics.
 * Returns a map of project_id → {timestamps, values} arrays.
 */
export async function queryMetricRangeByProject(
  metricName: string,
  start: Date,
  end: Date,
  stepSeconds: number
): Promise<Map<string, MetricSeries>> {
  if (!VM_URL) return new Map()

  const params = new URLSearchParams({
    query: metricName,
    start: String(Math.floor(start.getTime() / 1000)),
    end: String(Math.floor(end.getTime() / 1000)),
    step: String(stepSeconds),
  })
  const url = `${VM_URL}/api/v1/query_range?${params}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return new Map()

    const body = (await res.json()) as {
      status: string
      data: {
        resultType: string
        result: Array<{ metric: Record<string, string>; values: [number, string][] }>
      }
    }
    if (body.status !== 'success') return new Map()

    const map = new Map<string, MetricSeries>()
    for (const item of body.data.result) {
      const projectId = item.metric['project_id']
      if (!projectId) continue
      map.set(projectId, {
        timestamps: item.values.map(([t]) => t),
        values: item.values.map(([, v]) => parseFloat(v)),
      })
    }
    return map
  } catch {
    return new Map()
  }
}
