import { query, getRequestEvent } from '$app/server'
import { redirect, error } from '@sveltejs/kit'
import { db, namespaces, projects, organizations, orgMembers } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { resolvePermissions } from '$lib/server/permissions'
import { fetchMetricsForProjects, queryMetricRangeByProject } from '$lib/server/project-metrics'
import type { MetricSeries } from '$lib/server/project-metrics'
import * as v from 'valibot'

export type TimeWindow = '1h' | '6h' | '24h' | '7d' | '30d'
export type GroupBy = 'total' | 'project' | 'namespace'

export type MetricSeriesData = {
  id: string
  label: string
  series: MetricSeries
}

export type MetricsRangeResult = {
  cpu: MetricSeriesData[]
  memory: MetricSeriesData[]
  disk: MetricSeriesData[]
  ingressEgress: { ingress: MetricSeriesData[]; egress: MetricSeriesData[] }
}

const METRICS = [
  'slipstream_cpu_seconds_total',
  'slipstream_memory_bytes',
  'slipstream_disk_bytes',
  'slipstream_network_ingress_bytes_total',
  'slipstream_network_egress_bytes_total',
] as const

function windowToRange(window: TimeWindow): { start: Date; end: Date; stepSeconds: number } {
  const end = new Date()
  const map: Record<TimeWindow, { seconds: number; step: number }> = {
    '1h': { seconds: 3600, step: 60 },
    '6h': { seconds: 6 * 3600, step: 300 },
    '24h': { seconds: 24 * 3600, step: 900 },
    '7d': { seconds: 7 * 86400, step: 3600 },
    '30d': { seconds: 30 * 86400, step: 21600 },
  }
  const { seconds, step } = map[window]
  return { start: new Date(end.getTime() - seconds * 1000), end, stepSeconds: step }
}

function aggregateSeries(seriesList: MetricSeriesData[]): MetricSeries {
  if (seriesList.length === 0) return { timestamps: [], values: [] }
  const base = seriesList[0].series
  const agg = base.values.map((_, i) =>
    seriesList.reduce((sum, s) => sum + (s.series.values[i] ?? 0), 0)
  )
  return { timestamps: base.timestamps, values: agg }
}

function toSeriesData(
  projectRows: { id: string; displayName: string; namespaceId: string }[],
  maps: Map<string, MetricSeries>[],
  groupBy: GroupBy,
  nsMap?: Map<string, { slug: string }>
): MetricSeriesData[][] {
  const perProject = projectRows.map((p, _i) =>
    maps.map((m) => ({
      id: p.id,
      label: p.displayName,
      series: m.get(p.id) ?? { timestamps: [], values: [] },
    }))
  )

  if (groupBy === 'total') {
    return maps.map((_, mi) => [
      {
        id: 'total',
        label: 'Total',
        series: aggregateSeries(perProject.map((pp) => pp[mi])),
      },
    ])
  }

  if (groupBy === 'namespace' && nsMap) {
    const byNs = new Map<string, { id: string; label: string; seriesPerMetric: MetricSeries[] }>()
    for (const p of projectRows) {
      const ns = nsMap.get(p.namespaceId)
      if (!ns) continue
      if (!byNs.has(p.namespaceId)) {
        byNs.set(p.namespaceId, {
          id: p.namespaceId,
          label: ns.slug,
          seriesPerMetric: maps.map(() => ({ timestamps: [], values: [] })),
        })
      }
      const entry = byNs.get(p.namespaceId)!
      maps.forEach((m, mi) => {
        const s = m.get(p.id)
        if (!s) return
        const existing = entry.seriesPerMetric[mi]
        if (existing.timestamps.length === 0) {
          entry.seriesPerMetric[mi] = { timestamps: s.timestamps, values: [...s.values] }
        } else {
          s.values.forEach((v, i) => {
            existing.values[i] = (existing.values[i] ?? 0) + v
          })
        }
      })
    }
    return maps.map((_, mi) =>
      Array.from(byNs.values()).map((e) => ({
        id: e.id,
        label: e.label,
        series: e.seriesPerMetric[mi],
      }))
    )
  }

  // groupBy === 'project'
  return maps.map((_, mi) => perProject.map((pp) => pp[mi]))
}

export type MetricsRow = {
  id: string
  label: string
  href?: string
  cpu: number
  memory: number
  disk: number
  ingress: number
  egress: number
}

export const getProjectMetrics = query(async () => {
  const { locals, params } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, params.namespace!))
    .limit(1)
  if (nsRows.length === 0) error(404, 'Namespace not found')

  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.namespaceId, nsRows[0].id), eq(projects.slug, params.project!)))
    .limit(1)
  if (projectRows.length === 0) error(404, 'Project not found')

  const project = projectRows[0]
  const perms = await resolvePermissions(locals.user, project.id)
  if (perms.length === 0) error(403, 'Access denied')

  const metricsMap = await fetchMetricsForProjects([project.id])
  const m = metricsMap.get(project.id)!

  return {
    title: project.displayName,
    rows: [
      {
        id: project.id,
        label: project.displayName,
        cpu: m.cpu,
        memory: m.memory,
        disk: m.disk,
        ingress: m.ingress,
        egress: m.egress,
      } satisfies MetricsRow,
    ],
  }
})

export const getNamespaceMetrics = query(async () => {
  const { locals, params } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, params.namespace!))
    .limit(1)
  if (nsRows.length === 0) error(404, 'Namespace not found')

  const namespace = nsRows[0]

  if (namespace.type === 'user') {
    if (namespace.id !== locals.user.namespaceId) error(403, 'Access denied')
  } else {
    const orgRows = await db
      .select()
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, locals.user.id))
      )
      .where(eq(organizations.namespaceId, namespace.id))
      .limit(1)
    if (orgRows.length === 0) error(403, 'Access denied')
  }

  const projectRows = await db.select().from(projects).where(eq(projects.namespaceId, namespace.id))

  const metricsMap = await fetchMetricsForProjects(projectRows.map((p) => p.id))

  const rows: MetricsRow[] = projectRows.map((p) => {
    const m = metricsMap.get(p.id) ?? { cpu: 0, memory: 0, disk: 0, ingress: 0, egress: 0 }
    return {
      id: p.id,
      label: p.displayName,
      href: `/${namespace.slug}/${p.slug}`,
      cpu: m.cpu,
      memory: m.memory,
      disk: m.disk,
      ingress: m.ingress,
      egress: m.egress,
    }
  })

  return { title: namespace.slug, rows }
})

export const getAdminMetrics = query(async () => {
  const { locals } = getRequestEvent()
  if (!locals.user || locals.user.role !== 'admin') error(403, 'Forbidden')

  const [allNamespaces, allProjects] = await Promise.all([
    db.select().from(namespaces),
    db.select().from(projects),
  ])

  const nsMap = new Map(allNamespaces.map((ns) => [ns.id, ns]))
  const metricsMap = await fetchMetricsForProjects(allProjects.map((p) => p.id))

  // Aggregate metrics per namespace
  const nsMetrics = new Map<
    string,
    { cpu: number; memory: number; disk: number; ingress: number; egress: number }
  >()

  for (const p of allProjects) {
    const m = metricsMap.get(p.id) ?? { cpu: 0, memory: 0, disk: 0, ingress: 0, egress: 0 }
    const existing = nsMetrics.get(p.namespaceId) ?? {
      cpu: 0,
      memory: 0,
      disk: 0,
      ingress: 0,
      egress: 0,
    }
    nsMetrics.set(p.namespaceId, {
      cpu: existing.cpu + m.cpu,
      memory: existing.memory + m.memory,
      disk: existing.disk + m.disk,
      ingress: existing.ingress + m.ingress,
      egress: existing.egress + m.egress,
    })
  }

  const rows: MetricsRow[] = []
  for (const [nsId, m] of nsMetrics) {
    const ns = nsMap.get(nsId)
    if (!ns) continue
    rows.push({
      id: nsId,
      label: ns.slug,
      href: `/${ns.slug}/metrics`,
      cpu: m.cpu,
      memory: m.memory,
      disk: m.disk,
      ingress: m.ingress,
      egress: m.egress,
    })
  }

  rows.sort((a, b) => b.cpu - a.cpu)

  return { rows }
})

const windowSchema = v.union([
  v.literal('1h'),
  v.literal('6h'),
  v.literal('24h'),
  v.literal('7d'),
  v.literal('30d'),
])

export const getProjectMetricsRange = query(
  v.object({ window: windowSchema }),
  async (arg: { window: TimeWindow }) => {
    const { locals, params } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, params.namespace!))
      .limit(1)
    if (nsRows.length === 0) error(404, 'Namespace not found')

    const projectRows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.namespaceId, nsRows[0].id), eq(projects.slug, params.project!)))
      .limit(1)
    if (projectRows.length === 0) error(404, 'Project not found')

    const project = projectRows[0]
    const perms = await resolvePermissions(locals.user, project.id)
    if (perms.length === 0) error(403, 'Access denied')

    const { start, end, stepSeconds } = windowToRange(arg.window)
    const [cpu, memory, disk, ingress, egress] = await Promise.all(
      METRICS.map((m) => queryMetricRangeByProject(m, start, end, stepSeconds))
    )

    const p = { id: project.id, displayName: project.displayName, namespaceId: project.namespaceId }
    const [cpuS, memS, diskS, ingressS, egressS] = toSeriesData(
      [p],
      [cpu, memory, disk, ingress, egress],
      'project'
    )

    return {
      cpu: cpuS,
      memory: memS,
      disk: diskS,
      ingressEgress: { ingress: ingressS, egress: egressS },
    } satisfies MetricsRangeResult
  }
)

export const getNamespaceMetricsRange = query(
  v.object({ window: windowSchema, groupBy: v.union([v.literal('total'), v.literal('project')]) }),
  async (arg: { window: TimeWindow; groupBy: 'total' | 'project' }) => {
    const { locals, params } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, params.namespace!))
      .limit(1)
    if (nsRows.length === 0) error(404, 'Namespace not found')

    const namespace = nsRows[0]
    if (namespace.type === 'user') {
      if (namespace.id !== locals.user.namespaceId) error(403, 'Access denied')
    } else {
      const orgRows = await db
        .select()
        .from(organizations)
        .innerJoin(
          orgMembers,
          and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, locals.user.id))
        )
        .where(eq(organizations.namespaceId, namespace.id))
        .limit(1)
      if (orgRows.length === 0) error(403, 'Access denied')
    }

    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.namespaceId, namespace.id))

    const { start, end, stepSeconds } = windowToRange(arg.window)
    const [cpu, memory, disk, ingress, egress] = await Promise.all(
      METRICS.map((m) => queryMetricRangeByProject(m, start, end, stepSeconds))
    )

    const ps = projectRows.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      namespaceId: p.namespaceId,
    }))
    const [cpuS, memS, diskS, ingressS, egressS] = toSeriesData(
      ps,
      [cpu, memory, disk, ingress, egress],
      arg.groupBy
    )

    return {
      cpu: cpuS,
      memory: memS,
      disk: diskS,
      ingressEgress: { ingress: ingressS, egress: egressS },
    } satisfies MetricsRangeResult
  }
)

export const getAdminMetricsRange = query(
  v.object({
    window: windowSchema,
    groupBy: v.union([v.literal('total'), v.literal('project'), v.literal('namespace')]),
  }),
  async (arg: { window: TimeWindow; groupBy: GroupBy }) => {
    const { locals } = getRequestEvent()
    if (!locals.user || locals.user.role !== 'admin') error(403, 'Forbidden')

    const [allNamespaces, allProjects] = await Promise.all([
      db.select().from(namespaces),
      db.select().from(projects),
    ])

    const nsMap = new Map(allNamespaces.map((ns) => [ns.id, { slug: ns.slug }]))

    const { start, end, stepSeconds } = windowToRange(arg.window)
    const [cpu, memory, disk, ingress, egress] = await Promise.all(
      METRICS.map((m) => queryMetricRangeByProject(m, start, end, stepSeconds))
    )

    const ps = allProjects.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      namespaceId: p.namespaceId,
    }))
    const [cpuS, memS, diskS, ingressS, egressS] = toSeriesData(
      ps,
      [cpu, memory, disk, ingress, egress],
      arg.groupBy,
      nsMap
    )

    return {
      cpu: cpuS,
      memory: memS,
      disk: diskS,
      ingressEgress: { ingress: ingressS, egress: egressS },
    } satisfies MetricsRangeResult
  }
)
