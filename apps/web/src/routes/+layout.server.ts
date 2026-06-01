import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'

const PUBLIC_PATHS = ['/auth/login', '/auth/callback', '/auth/dev', '/auth/logout']

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const isPublic = PUBLIC_PATHS.some((p) => url.pathname.startsWith(p))

  if (!locals.user && !isPublic) {
    throw redirect(302, '/auth/login')
  }

  return { user: locals.user ?? null }
}
