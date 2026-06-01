import { json, error } from '@sveltejs/kit'
import { updateThemePreference } from '$lib/remote/auth.remote'

export const POST = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'Unauthorized')

  const body = await request.json()
  const { theme } = body

  if (!['system', 'light', 'dark'].includes(theme)) {
    throw error(400, 'Invalid theme: must be one of system, light, dark')
  }

  await updateThemePreference(locals.user.id, theme as 'system' | 'light' | 'dark')
  return json({ ok: true })
}
