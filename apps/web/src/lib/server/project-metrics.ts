import { queryMetricByProject } from './victoriametrics'

export type ProjectMetricsSnapshot = {
  projectId: string
  cpu: number
  memory: number
  disk: number
  ingress: number
  egress: number
}

export async function fetchMetricsForProjects(
  projectIds: string[]
): Promise<Map<string, ProjectMetricsSnapshot>> {
  if (projectIds.length === 0) return new Map()

  const [cpu, memory, disk, ingress, egress] = await Promise.all([
    queryMetricByProject('slipstream_cpu_seconds_total'),
    queryMetricByProject('slipstream_memory_bytes'),
    queryMetricByProject('slipstream_disk_bytes'),
    queryMetricByProject('slipstream_network_ingress_bytes_total'),
    queryMetricByProject('slipstream_network_egress_bytes_total'),
  ])

  const result = new Map<string, ProjectMetricsSnapshot>()
  for (const id of projectIds) {
    result.set(id, {
      projectId: id,
      cpu: cpu.get(id) ?? 0,
      memory: memory.get(id) ?? 0,
      disk: disk.get(id) ?? 0,
      ingress: ingress.get(id) ?? 0,
      egress: egress.get(id) ?? 0,
    })
  }
  return result
}
