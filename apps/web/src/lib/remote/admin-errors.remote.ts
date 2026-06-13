import { query, command, getRequestEvent } from '$app/server'
import { error } from '@sveltejs/kit'

function requireAdmin() {
  const { locals } = getRequestEvent()
  if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden')
}
import { db, serverErrors, users } from '$lib/server/db'
import { and, gte, lte, eq, desc } from 'drizzle-orm'
import type { ServerError } from '$lib/server/db/schema'
import * as v from 'valibot'

export type ErrorRow = ServerError & { userEmail: string | null }

export const getErrors = query(
  v.object({
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    route: v.optional(v.string()),
    userId: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  }),
  async (arg: {
    fromDate?: string
    toDate?: string
    route?: string
    userId?: string
    limit?: number
    offset?: number
  }): Promise<{ rows: ErrorRow[]; total: number }> => {
    requireAdmin()
    const conditions = []

    if (arg.fromDate) conditions.push(gte(serverErrors.occurredAt, new Date(arg.fromDate)))
    if (arg.toDate) {
      const to = new Date(arg.toDate)
      to.setDate(to.getDate() + 1)
      conditions.push(lte(serverErrors.occurredAt, to))
    }
    if (arg.route) conditions.push(eq(serverErrors.route, arg.route))
    if (arg.userId) conditions.push(eq(serverErrors.userId, arg.userId))

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const limit = arg.limit ?? 50
    const offset = arg.offset ?? 0

    const [rows, countRows] = await Promise.all([
      db
        .select({ error: serverErrors, user: users })
        .from(serverErrors)
        .leftJoin(users, eq(serverErrors.userId, users.id))
        .where(where)
        .orderBy(desc(serverErrors.occurredAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ error: serverErrors, user: users })
        .from(serverErrors)
        .leftJoin(users, eq(serverErrors.userId, users.id))
        .where(where),
    ])

    return {
      rows: rows.map((r) => ({ ...r.error, userEmail: r.user?.email ?? null })),
      total: countRows.length,
    }
  }
)

export const getErrorRoutes = query(async (): Promise<string[]> => {
  requireAdmin()
  const rows = await db
    .selectDistinct({ route: serverErrors.route })
    .from(serverErrors)
    .orderBy(serverErrors.route)
  return rows.map((r) => r.route).filter((r): r is string => r !== null)
})

export const deleteErrors = command(
  v.object({
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    route: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  async (arg: {
    fromDate?: string
    toDate?: string
    route?: string
    userId?: string
  }): Promise<{ deleted: number }> => {
    const { locals } = getRequestEvent()
    if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden')

    const conditions = []
    if (arg.fromDate) conditions.push(gte(serverErrors.occurredAt, new Date(arg.fromDate)))
    if (arg.toDate) {
      const to = new Date(arg.toDate)
      to.setDate(to.getDate() + 1)
      conditions.push(lte(serverErrors.occurredAt, to))
    }
    if (arg.route) conditions.push(eq(serverErrors.route, arg.route))
    if (arg.userId) conditions.push(eq(serverErrors.userId, arg.userId))

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const deleted = await db.delete(serverErrors).where(where).returning({ id: serverErrors.id })
    return { deleted: deleted.length }
  }
)
