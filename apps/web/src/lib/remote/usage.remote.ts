import { query, command } from '$app/server'
import { db, usageSamples, users } from '$lib/server/db'
import { eq, and, gte, lte } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { resolvePermissions } from '$lib/server/permissions'
import * as v from 'valibot'

type MetricType =
  | 'cpu_seconds'
  | 'memory_byte_seconds'
  | 'disk_bytes'
  | 'ingress_bytes'
  | 'egress_bytes'

const metricType = v.union([
  v.literal('cpu_seconds'),
  v.literal('memory_byte_seconds'),
  v.literal('disk_bytes'),
  v.literal('ingress_bytes'),
  v.literal('egress_bytes'),
])

export const recordUsageSample = command(
  v.object({
    actorUserId: v.string(),
    projectId: v.string(),
    metric: metricType,
    value: v.number(),
    sampledAt: v.date(),
  }),
  async (arg: {
    actorUserId: string
    projectId: string
    metric: MetricType
    value: number
    sampledAt: Date
  }): Promise<void> => {
    const userRows = await db.select().from(users).where(eq(users.id, arg.actorUserId)).limit(1)
    if (userRows.length === 0) throw error(403, 'Forbidden')

    const perms = await resolvePermissions(userRows[0], arg.projectId)
    if (!perms.includes('project:manage')) throw error(403, 'Forbidden')

    await db.insert(usageSamples).values({
      projectId: arg.projectId,
      metric: arg.metric,
      value: String(arg.value),
      sampledAt: arg.sampledAt,
    })
  }
)

export const getProjectUsage = query(
  v.object({
    actorUserId: v.string(),
    projectId: v.string(),
    from: v.date(),
    to: v.date(),
  }),
  async (arg: {
    actorUserId: string
    projectId: string
    from: Date
    to: Date
  }): Promise<Array<{ metric: string; value: number; sampledAt: Date }>> => {
    const userRows = await db.select().from(users).where(eq(users.id, arg.actorUserId)).limit(1)
    if (userRows.length === 0) throw error(403, 'Forbidden')

    const perms = await resolvePermissions(userRows[0], arg.projectId)
    if (!perms.includes('project:manage')) {
      throw error(403, 'You do not have permission to view usage for this project')
    }

    const rows = await db
      .select({
        metric: usageSamples.metric,
        value: usageSamples.value,
        sampledAt: usageSamples.sampledAt,
      })
      .from(usageSamples)
      .where(
        and(
          eq(usageSamples.projectId, arg.projectId),
          gte(usageSamples.sampledAt, arg.from),
          lte(usageSamples.sampledAt, arg.to)
        )
      )

    return rows.map((r) => ({
      metric: r.metric,
      value: parseFloat(r.value),
      sampledAt: r.sampledAt,
    }))
  }
)
