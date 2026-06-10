import { query } from '$app/server'
import { db, users, serverErrors } from '$lib/server/db'
import { sql, gte } from 'drizzle-orm'
import { listProjectEnvironments, phaseToProjectStatus } from '$lib/server/k8s/cr'

export const getDashboardStats = query('unchecked', async (_arg: Record<string, never>) => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [errorCount, userCount, crs] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(serverErrors)
      .where(gte(serverErrors.occurredAt, oneDayAgo))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .then((r) => r[0].count),
    listProjectEnvironments(),
  ])

  const activePodCount = crs.filter(
    (cr) => phaseToProjectStatus(cr.status?.phase) !== 'stopped'
  ).length

  return { errorCount, userCount, activePodCount }
})
