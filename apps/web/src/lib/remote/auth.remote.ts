import { command, getRequestEvent } from '$app/server'
import { db, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { error } from '@sveltejs/kit'

export const updateThemePreference = command(
  'unchecked',
  async (theme: 'system' | 'light' | 'dark') => {
    const { locals } = getRequestEvent()
    if (!locals.user) throw error(401, 'Unauthorized')
    if (!['system', 'light', 'dark'].includes(theme)) throw error(400, 'Invalid theme')
    const result = await db
      .update(users)
      .set({ themePreference: theme, updatedAt: new Date() })
      .where(eq(users.id, locals.user.id))
      .returning({ id: users.id })
    if (result.length === 0) throw error(404, 'User not found')
  }
)
