import { query, getRequestEvent } from '$app/server'
import { error } from '@sveltejs/kit'
import { db, projects, namespaces } from '$lib/server/db'
import { sql } from 'drizzle-orm'
import * as v from 'valibot'

export type BillingRow = {
  projectId: string
  projectSlug: string
  namespaceSlug: string
  cpuSeconds: number
  memoryByteSeconds: number
  diskBytes: number
  ingressBytes: number
  egressBytes: number
}

export const getBillingReport = query(
  v.object({
    from: v.string(),
    to: v.string(),
  }),
  async (arg: { from: string; to: string }) => {
    const { locals } = getRequestEvent()
    if (!locals.user || locals.user.role !== 'admin') error(403, 'Forbidden')

    const from = new Date(arg.from)
    const to = new Date(arg.to)

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      error(400, 'Invalid date range')
    }

    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    // Use LAG() window function to compute deltas from raw cumulative values.
    // GREATEST(..., 0) drops negative deltas (counter resets from pod restarts).
    const rows = await db.execute(sql`
      WITH deltas AS (
        SELECT
          project_id,
          metric,
          GREATEST(
            value::numeric - LAG(value::numeric) OVER (
              PARTITION BY project_id, metric ORDER BY sampled_at
            ),
            0
          ) AS delta
        FROM usage_samples
        WHERE sampled_at >= ${fromIso}::timestamptz
          AND sampled_at <= ${toIso}::timestamptz
      )
      SELECT
        project_id,
        SUM(CASE WHEN metric = 'cpu_seconds'         THEN delta ELSE 0 END) AS cpu_seconds,
        SUM(CASE WHEN metric = 'memory_byte_seconds' THEN delta ELSE 0 END) AS memory_byte_seconds,
        SUM(CASE WHEN metric = 'disk_bytes'          THEN delta ELSE 0 END) AS disk_bytes,
        SUM(CASE WHEN metric = 'ingress_bytes'       THEN delta ELSE 0 END) AS ingress_bytes,
        SUM(CASE WHEN metric = 'egress_bytes'        THEN delta ELSE 0 END) AS egress_bytes
      FROM deltas
      GROUP BY project_id
      ORDER BY cpu_seconds DESC
    `)

    // Look up project and namespace slugs.
    const allProjects = await db
      .select({ id: projects.id, slug: projects.slug, namespaceId: projects.namespaceId })
      .from(projects)
    const allNamespaces = await db
      .select({ id: namespaces.id, slug: namespaces.slug })
      .from(namespaces)

    const projectMap = new Map(allProjects.map((p) => [p.id, p]))
    const nsMap = new Map(allNamespaces.map((n) => [n.id, n]))

    const billingRows: BillingRow[] = []
    for (const row of rows) {
      const r = row as Record<string, unknown>
      const project = projectMap.get(r.project_id as string)
      if (!project) continue
      const ns = nsMap.get(project.namespaceId)
      billingRows.push({
        projectId: project.id,
        projectSlug: project.slug,
        namespaceSlug: ns?.slug ?? '—',
        cpuSeconds: Number(r.cpu_seconds ?? 0),
        memoryByteSeconds: Number(r.memory_byte_seconds ?? 0),
        diskBytes: Number(r.disk_bytes ?? 0),
        ingressBytes: Number(r.ingress_bytes ?? 0),
        egressBytes: Number(r.egress_bytes ?? 0),
      })
    }

    return { rows: billingRows, from: from.toISOString(), to: to.toISOString() }
  }
)
