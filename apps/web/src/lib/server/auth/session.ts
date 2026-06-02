import { db, sessions, users } from '$lib/server/db'
import { eq, and, gt, lt } from 'drizzle-orm'
import { createHmac, timingSafeEqual } from 'crypto'
import type { User, Session } from '$lib/server/db/schema'

export const SESSION_COOKIE_NAME = 'session'

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
}

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

// SESSION_SECRET must be set in production. Fallback is only for local dev.
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me'

// Cookie value format: "{sessionId}.{HMAC-SHA256(sessionId, SESSION_SECRET) as hex}"
function signSessionId(sessionId: string): string {
  const sig = createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex')
  return `${sessionId}.${sig}`
}

function verifySessionToken(token: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const sessionId = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex')
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null
  } catch {
    return null
  }
  return sessionId
}

export async function createSession(userId: string): Promise<{ session: Session; token: string }> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  const [session] = await db.insert(sessions).values({ userId, expiresAt }).returning()
  return { session, token: signSessionId(session.id) }
}

export async function validateSession(
  token: string
): Promise<{ user: User; session: Session } | null> {
  const sessionId = verifySessionToken(token)
  if (!sessionId) return null

  const now = new Date()
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1)

  if (rows.length === 0) return null
  return { session: rows[0].session, user: rows[0].user }
}

export async function deleteSession(token: string): Promise<void> {
  const sessionId = verifySessionToken(token)
  if (!sessionId) return
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

export async function deleteExpiredSessions(): Promise<void> {
  const now = new Date()
  await db.delete(sessions).where(lt(sessions.expiresAt, now))
}
