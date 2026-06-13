import type { Handle } from '@sveltejs/kit'
import { validateSession } from '$lib/server/auth/session'

const PUBLIC_API_ROUTES = ['/api/jwks']

// ---------------------------------------------------------------------------
// In-memory sliding-window rate limiter
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_AUTH = 20 // requests per minute per IP on auth/token endpoints

// Paths that are subject to the auth rate limit
const RATE_LIMITED_PREFIXES = ['/auth/login/', '/auth/callback/']

const rateLimitBuckets = new Map<string, number[]>()

function isRateLimited(ip: string, pathname: string): boolean {
  if (!RATE_LIMITED_PREFIXES.some((p) => pathname.startsWith(p))) return false

  const key = `${ip}:auth`
  const now = Date.now()
  const timestamps = rateLimitBuckets.get(key) ?? []
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX_AUTH) return true

  recent.push(now)
  rateLimitBuckets.set(key, recent)
  return false
}

// Prune the bucket map periodically to avoid unbounded growth.
setInterval(
  () => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
    for (const [key, timestamps] of rateLimitBuckets) {
      const kept = timestamps.filter((t) => t > cutoff)
      if (kept.length === 0) rateLimitBuckets.delete(key)
      else rateLimitBuckets.set(key, kept)
    }
  },
  5 * 60_000 // every 5 minutes
)

// ---------------------------------------------------------------------------
// Main handle hook
// ---------------------------------------------------------------------------

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

  // Rate-limit auth and token endpoints before any further processing.
  if (isRateLimited(event.getClientAddress(), pathname)) {
    return new Response(JSON.stringify({ error: 'too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    })
  }

  if (pathname.startsWith('/api/') && !PUBLIC_API_ROUTES.includes(pathname)) {
    if (!event.locals.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const response = await resolve(event)

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; img-src 'self' data: https:; font-src 'self' data:"
  )

  return response
}
