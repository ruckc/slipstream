import { command } from '$app/server'
import { db, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { error } from '@sveltejs/kit'

export const updateThemePreference = command(
  'unchecked',
  async (arg: { userId: string; theme: 'system' | 'light' | 'dark' }) => {
    const result = await db
      .update(users)
      .set({ themePreference: arg.theme, updatedAt: new Date() })
      .where(eq(users.id, arg.userId))
      .returning({ id: users.id })
    if (result.length === 0) throw error(404, 'User not found')
  }
)
