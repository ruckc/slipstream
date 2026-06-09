import { query, form, command, getRequestEvent } from '$app/server'
import { redirect, invalid } from '@sveltejs/kit'
import { db, users, oidcConnections } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import * as v from 'valibot'

export const getUserSettings = query(async () => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  const connections = await db
    .select()
    .from(oidcConnections)
    .where(eq(oidcConnections.userId, locals.user.id))

  return { user: locals.user, connections }
})

export const updateProfile = form(
  'unchecked',
  async (data: { displayName: string; avatarUrl: string }, issue) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const displayName = String(data.displayName ?? '').trim()
    const avatarUrl = String(data.avatarUrl ?? '').trim() || null

    if (!displayName) invalid(issue.displayName('Display name is required'))

    await db
      .update(users)
      .set({ displayName, avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, locals.user.id))

    return { success: true as const }
  }
)

export const updateIdleTimeout = form(
  'unchecked',
  async (data: { idleTimeoutSeconds: string }, issue) => {
    const { locals } = getRequestEvent()
    if (!locals.user) redirect(302, '/auth/login')

    const raw = String(data.idleTimeoutSeconds ?? '').trim()
    const idleTimeoutSeconds = raw === '' ? null : parseInt(raw, 10)

    if (idleTimeoutSeconds !== null && (isNaN(idleTimeoutSeconds) || idleTimeoutSeconds < 60)) {
      invalid(issue.idleTimeoutSeconds('Idle timeout must be at least 60 seconds'))
    }

    await db
      .update(users)
      .set({ idleTimeoutSeconds, updatedAt: new Date() })
      .where(eq(users.id, locals.user.id))

    return { success: true as const }
  }
)

export const unlinkProvider = command(v.string(), async (connectionId: string) => {
  const { locals } = getRequestEvent()
  if (!locals.user) redirect(302, '/auth/login')

  await db
    .delete(oidcConnections)
    .where(and(eq(oidcConnections.id, connectionId), eq(oidcConnections.userId, locals.user.id)))
})
