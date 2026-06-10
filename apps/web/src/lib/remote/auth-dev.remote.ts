import { query, command, getRequestEvent } from '$app/server'
import { redirect, error } from '@sveltejs/kit'
import { DEV_ACCOUNT_UUIDS, type DevAccountUUID } from '$lib/server/dev/seed-accounts'
import { db, users } from '$lib/server/db'
import { eq, inArray } from 'drizzle-orm'
import {
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from '$lib/server/auth/session'
import * as v from 'valibot'

export const getDevAccounts = query(async () => {
  const { locals } = getRequestEvent()
  if (locals.user) redirect(302, '/')
  if (process.env.DEV_MODE !== 'true') redirect(302, '/auth/login')

  const accounts = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...DEV_ACCOUNT_UUIDS]))

  return { accounts }
})

export const loginAsDev = command(v.string(), async (uuid: string) => {
  if (process.env.DEV_MODE !== 'true') error(403, 'Dev mode disabled')
  if (!DEV_ACCOUNT_UUIDS.includes(uuid as DevAccountUUID)) error(400, 'Invalid account')

  const [user] = await db.select().from(users).where(eq(users.id, uuid))
  if (!user) error(404, 'Account not found — run db:seed:dev first')

  const { token } = await createSession(user.id)
  const { cookies } = getRequestEvent()
  cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)

  return { ok: true }
})
