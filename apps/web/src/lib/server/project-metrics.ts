import { db } from './db'
import { sql } from 'drizzle-orm'

export type MetricSeries = {
  timestamps: number[]
  values: number[]
}

export type ProjectMetricsSnapshot = {
  projectId: string
  cpu: number
  memory: number
  disk: number
  ingress: number
  egress: number
  externalEgress: number
  internalEgress: number
  externalIngress: number
  internalIngress: number
}

// Map from usage_samples.metric → snapshot field
const SNAPSHOT_METRICS = [
  'cpu_seconds',
  'memory_byte_seconds',
  'disk_bytes',
  'ingress_bytes',
  'egress_bytes',
  'external_egress_bytes',
  'internal_egress_bytes',
  'external_ingress_bytes',
  'internal_ingress_bytes',
] as const
type SnapshotMetric = (typeof SNAPSHOT_METRICS)[number]

/**
 * Latest value for each metric per project, reading from usage_samples.
 * Returns the most recent sample within the last 10 minutes for each metric.
 */
export async function fetchMetricsForProjects(
  projectIds: string[]
): Promise<Map<string, ProjectMetricsSnapshot>> {
  if (projectIds.length === 0) return new Map()

  // Get latest sample per project per metric
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (project_id, metric)
      project_id,
      metric,
      value::float8 AS value
    FROM usage_samples
    WHERE project_id = ANY(${projectIds}::uuid[])
      AND metric = ANY(${[...SNAPSHOT_METRICS]}::text[])
    ORDER BY project_id, metric, sampled_at DESC
  `)

  const result = new Map<string, ProjectMetricsSnapshot>()
  for (const id of projectIds) {
    result.set(id, {
      projectId: id,
      cpu: 0,
      memory: 0,
      disk: 0,
      ingress: 0,
      egress: 0,
      externalEgress: 0,
      internalEgress: 0,
      externalIngress: 0,
      internalIngress: 0,
    })
  }

  for (const row of rows) {
    const snap = result.get(row.project_id as string)
    if (!snap) continue
    const v = Number(row.value)
    switch (row.metric as SnapshotMetric) {
      case 'cpu_seconds':
        snap.cpu = v
        break
      case 'memory_byte_seconds':
        snap.memory = v
        break
      case 'disk_bytes':
        snap.disk = v
        break
      case 'ingress_bytes':
        snap.ingress = v
        break
      case 'egress_bytes':
        snap.egress = v
        break
      case 'external_egress_bytes':
        snap.externalEgress = v
        break
      case 'internal_egress_bytes':
        snap.internalEgress = v
        break
      case 'external_ingress_bytes':
        snap.externalIngress = v
        break
      case 'internal_ingress_bytes':
        snap.internalIngress = v
        break
    }
  }

  return result
}

// Map from public metric name → usage_samples.metric
const RANGE_METRIC_MAP: Record<string, SnapshotMetric> = {
  slipstream_cpu_seconds_total: 'cpu_seconds',
  slipstream_memory_bytes: 'memory_byte_seconds',
  slipstream_disk_bytes: 'disk_bytes',
  slipstream_network_ingress_bytes_total: 'ingress_bytes',
  slipstream_network_egress_bytes_total: 'egress_bytes',
  slipstream_external_egress_bytes_total: 'external_egress_bytes',
  slipstream_internal_egress_bytes_total: 'internal_egress_bytes',
  slipstream_external_ingress_bytes_total: 'external_ingress_bytes',
  slipstream_internal_ingress_bytes_total: 'internal_ingress_bytes',
}

/**
 * Time-bucketed range query from usage_samples.
 * Returns a map of project_id → {timestamps (unix secs), values}.
 */
export async function queryMetricRangeByProject(
  metricName: string,
  start: Date,
  end: Date,
  stepSeconds: number
): Promise<Map<string, MetricSeries>> {
  const dbMetric = RANGE_METRIC_MAP[metricName]
  if (!dbMetric) return new Map()

  const startIso = start.toISOString()
  const endIso = end.toISOString()

  const rows = await db.execute(sql`
    SELECT
      project_id,
      (EXTRACT(EPOCH FROM sampled_at)::bigint / ${stepSeconds}) * ${stepSeconds} AS bucket_ts,
      AVG(value::numeric)::float8 AS avg_value
    FROM usage_samples
    WHERE metric = ${dbMetric}
      AND sampled_at >= ${startIso}::timestamptz
      AND sampled_at <= ${endIso}::timestamptz
    GROUP BY project_id, bucket_ts
    ORDER BY project_id, bucket_ts
  `)

  const map = new Map<string, MetricSeries>()
  for (const row of rows) {
    const pid = row.project_id as string
    if (!map.has(pid)) map.set(pid, { timestamps: [], values: [] })
    const s = map.get(pid)!
    s.timestamps.push(Number(row.bucket_ts))
    s.values.push(Number(row.avg_value))
  }
  return map
}
