import { redirect, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { db, users, oidcConnections } from '$lib/server/db'
import { eq } from 'drizzle-orm'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')

  const connections = await db
    .select()
    .from(oidcConnections)
    .where(eq(oidcConnections.userId, locals.user.id))

  return {
    user: locals.user,
    connections,
  }
}

export const actions: Actions = {
  updateProfile: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const displayName = String(data.get('displayName') ?? '').trim()
    const avatarUrl = String(data.get('avatarUrl') ?? '').trim() || null

    if (!displayName) return fail(400, { profile: true, error: 'Display name is required' })

    await db
      .update(users)
      .set({ displayName, avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, locals.user.id))

    return { profile: true, success: true }
  },

  updateTheme: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const theme = String(data.get('theme') ?? '').trim()

    if (!['system', 'light', 'dark'].includes(theme)) {
      return fail(400, { theme: true, error: 'Invalid theme value' })
    }

    await db
      .update(users)
      .set({ themePreference: theme, updatedAt: new Date() })
      .where(eq(users.id, locals.user.id))

    return { theme: true, success: true }
  },

  updateIdleTimeout: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const raw = String(data.get('idleTimeoutSeconds') ?? '').trim()
    const idleTimeoutSeconds = raw === '' ? null : parseInt(raw, 10)

    if (idleTimeoutSeconds !== null && (isNaN(idleTimeoutSeconds) || idleTimeoutSeconds < 60)) {
      return fail(400, { timeout: true, error: 'Idle timeout must be at least 60 seconds' })
    }

    await db
      .update(users)
      .set({ idleTimeoutSeconds, updatedAt: new Date() })
      .where(eq(users.id, locals.user.id))

    return { timeout: true, success: true }
  },

  unlinkProvider: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/auth/login')

    const data = await request.formData()
    const connectionId = String(data.get('connectionId') ?? '').trim()

    if (!connectionId) return fail(400, { error: 'Connection ID is required' })

    await db
      .delete(oidcConnections)
      .where(
        eq(oidcConnections.id, connectionId),
      )

    return { unlink: true, success: true }
  },
}
