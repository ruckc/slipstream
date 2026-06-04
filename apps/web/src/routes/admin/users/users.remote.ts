import { query, command } from '$app/server'
import { db, users, namespaces } from '$lib/server/db'
import { eq, asc } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { getRequestEvent } from '$app/server'
import type { User } from '$lib/server/db/schema'

export type UserRow = User & { namespaceSlug: string }

export const listUsers = query(
  'unchecked',
  async (_arg: Record<string, never>): Promise<UserRow[]> => {
    const rows = await db
      .select({ user: users, namespace: namespaces })
      .from(users)
      .innerJoin(namespaces, eq(users.namespaceId, namespaces.id))
      .orderBy(asc(users.createdAt))

    return rows.map((r) => ({ ...r.user, namespaceSlug: r.namespace.slug }))
  }
)

export const setUserRole = command(
  'unchecked',
  async (arg: { targetUserId: string; role: 'admin' | 'user' }): Promise<void> => {
    const event = getRequestEvent()
    const actorId = event?.locals.user?.id
    if (!actorId) throw error(401, 'Unauthorized')
    if (arg.targetUserId === actorId) throw error(400, 'Cannot change your own role')
    if (arg.role !== 'admin' && arg.role !== 'user') throw error(400, 'Invalid role')

    await db.update(users).set({ role: arg.role }).where(eq(users.id, arg.targetUserId))
  }
)
