import { query, getRequestEvent } from '$app/server'
import { error } from '@sveltejs/kit'
import { db, users, serverErrors } from '$lib/server/db'
import { sql, gte } from 'drizzle-orm'
import { listProjectEnvironments, phaseToProjectStatus } from '$lib/server/k8s/cr'

function requireAdmin() {
  const { locals } = getRequestEvent()
  if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden')
}

export const getDashboardStats = query(async () => {
  requireAdmin()
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
