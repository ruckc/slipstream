import { query } from '$app/server'
import { db, users, serverErrors, projects } from '$lib/server/db'
import { sql, gte } from 'drizzle-orm'

export const getDashboardStats = query('unchecked', async (_arg: Record<string, never>) => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [errorCount, userCount, activePodCount] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(serverErrors)
      .where(gte(serverErrors.occurredAt, oneDayAgo))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(sql`status IN ('starting', 'running')`)
      .then((r) => r[0].count),
  ])

  return { errorCount, userCount, activePodCount }
})
