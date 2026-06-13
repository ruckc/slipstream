import { query, command, getRequestEvent } from '$app/server'
import { db, users, namespaces } from '$lib/server/db'
import { eq, asc } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import type { User } from '$lib/server/db/schema'
import * as v from 'valibot'

export type UserRow = User & { namespaceSlug: string }

function requireAdmin() {
  const { locals } = getRequestEvent()
  if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Forbidden')
}

export const listUsers = query(async (): Promise<UserRow[]> => {
  requireAdmin()
  const rows = await db
    .select({ user: users, namespace: namespaces })
    .from(users)
    .innerJoin(namespaces, eq(users.namespaceId, namespaces.id))
    .orderBy(asc(users.createdAt))

  return rows.map((r) => ({ ...r.user, namespaceSlug: r.namespace.slug }))
})

export const setUserRole = command(
  v.object({ targetUserId: v.string(), role: v.union([v.literal('admin'), v.literal('user')]) }),
  async (arg: { targetUserId: string; role: 'admin' | 'user' }): Promise<void> => {
    const event = getRequestEvent()
    requireAdmin()
    const actorId = event?.locals.user?.id
    if (!actorId) throw error(401, 'Unauthorized')
    if (arg.targetUserId === actorId) throw error(400, 'Cannot change your own role')
    if (arg.role !== 'admin' && arg.role !== 'user') throw error(400, 'Invalid role')

    await db.update(users).set({ role: arg.role }).where(eq(users.id, arg.targetUserId))
    console.log(
      JSON.stringify({
        audit: true,
        action: 'setUserRole',
        actor: actorId,
        target: arg.targetUserId,
        role: arg.role,
        ts: new Date().toISOString(),
      })
    )
  }
)
