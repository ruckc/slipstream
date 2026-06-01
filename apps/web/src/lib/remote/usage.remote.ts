import { db, usageSamples, projects, users } from '$lib/server/db'
import { eq, and, gte, lte } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { resolvePermissions } from '$lib/server/permissions'

type MetricType =
  | 'cpu_seconds'
  | 'memory_byte_seconds'
  | 'disk_bytes'
  | 'ingress_bytes'
  | 'egress_bytes'

export async function recordUsageSample(
  projectId: string,
  metric: MetricType,
  value: number,
  sampledAt: Date
): Promise<void> {
  // Verify project exists
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (projectRows.length === 0) {
    throw error(404, 'Project not found')
  }

  await db.insert(usageSamples).values({
    projectId,
    metric,
    value: String(value),
    sampledAt,
  })
}

export async function getProjectUsage(
  actorUserId: string,
  projectId: string,
  from: Date,
  to: Date
): Promise<Array<{ metric: string; value: number; sampledAt: Date }>> {
  // Actor must have project:manage permission
  const userRows = await db.select().from(users).where(eq(users.id, actorUserId)).limit(1)

  if (userRows.length === 0) {
    throw error(403, 'Forbidden')
  }

  const perms = await resolvePermissions(userRows[0], projectId)
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
        eq(usageSamples.projectId, projectId),
        gte(usageSamples.sampledAt, from),
        lte(usageSamples.sampledAt, to)
      )
    )

  return rows.map((r) => ({
    metric: r.metric,
    value: parseFloat(r.value),
    sampledAt: r.sampledAt,
  }))
}
