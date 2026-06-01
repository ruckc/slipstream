import { db, sessions, users } from '$lib/server/db'
import { eq, and, gt, lt } from 'drizzle-orm'
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

export async function createSession(userId: string): Promise<Session> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  const [session] = await db
    .insert(sessions)
    .values({ userId, expiresAt })
    .returning()
  return session
}

export async function validateSession(
  sessionId: string,
): Promise<{ user: User; session: Session } | null> {
  const now = new Date()

  const rows = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1)

  if (rows.length === 0) return null

  return { session: rows[0].session, user: rows[0].user }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

export async function deleteExpiredSessions(): Promise<void> {
  const now = new Date()
  await db.delete(sessions).where(lt(sessions.expiresAt, now))
}
