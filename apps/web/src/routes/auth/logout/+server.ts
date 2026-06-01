import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { deleteSession, SESSION_COOKIE_NAME } from '$lib/server/auth/session'

export const POST: RequestHandler = async ({ cookies }) => {
  const sessionId = cookies.get(SESSION_COOKIE_NAME)

  if (sessionId) {
    await deleteSession(sessionId)
  }

  cookies.delete(SESSION_COOKIE_NAME, { path: '/' })

  throw redirect(302, '/auth/login')
}
