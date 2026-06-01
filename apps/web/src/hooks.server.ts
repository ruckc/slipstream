import type { Handle } from '@sveltejs/kit'
import { validateSession } from '$lib/server/auth/session'

const PUBLIC_API_ROUTES = ['/api/jwks', '/api/token']

export const handle: Handle = async ({ event, resolve }) => {
  const sessionToken = event.cookies.get('session') ?? null

  if (sessionToken) {
    const result = await validateSession(sessionToken)
    event.locals.user = result?.user ?? null
    event.locals.session = result?.session ?? null
  } else {
    event.locals.user = null
    event.locals.session = null
  }

  const { pathname } = event.url

  if (pathname.startsWith('/api/') && !PUBLIC_API_ROUTES.includes(pathname)) {
    if (!event.locals.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  return resolve(event)
}
