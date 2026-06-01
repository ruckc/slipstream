import { db, users } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import { error } from '@sveltejs/kit'

export async function updateThemePreference(
  userId: string,
  theme: 'system' | 'light' | 'dark',
): Promise<void> {
  const result = await db
    .update(users)
    .set({ themePreference: theme, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id })

  if (result.length === 0) {
    throw error(404, 'User not found')
  }
}
