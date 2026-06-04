import { error, redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/auth/login')
  if (locals.user.role !== 'admin') throw error(403, 'Forbidden')
  return { user: locals.user }
}
