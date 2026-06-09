import { query } from '$app/server'
import { db, users, serverErrors } from '$lib/server/db'
import { sql, gte } from 'drizzle-orm'
import { listDeploymentStatuses } from '$lib/server/k8s/deployment'

export const getDashboardStats = query(async () => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [errorCount, userCount, statuses] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(serverErrors)
      .where(gte(serverErrors.occurredAt, oneDayAgo))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .then((r) => r[0].count),
    listDeploymentStatuses(),
  ])

  const activePodCount = [...statuses.values()].filter((s) => s !== 'stopped').length

  return { errorCount, userCount, activePodCount }
})
