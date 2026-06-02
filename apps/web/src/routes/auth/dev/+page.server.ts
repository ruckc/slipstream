import type { PageServerLoad, Actions } from './$types'
import { DEV_ACCOUNT_UUIDS, type DevAccountUUID } from '$lib/server/dev/seed-accounts'
import { db, users } from '$lib/server/db'
import { eq, inArray } from 'drizzle-orm'
import {
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from '$lib/server/auth/session'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ locals }) => {
  // Redirect if already logged in
  if (locals.user) throw redirect(302, '/')

  const devMode = process.env.DEV_MODE === 'true'
  if (!devMode) throw redirect(302, '/auth/login')

  // Only show accounts that actually exist in DB
  const found = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...DEV_ACCOUNT_UUIDS]))
  return { accounts: found, devMode }
}

export const actions: Actions = {
  login: async ({ request, cookies }) => {
    // Triple validation:
    // 1. DEV_MODE must be 'true'
    // 2. uuid must be in DEV_ACCOUNT_UUIDS
    // 3. User must exist in DB
    const formData = await request.formData()
    const uuid = formData.get('uuid')?.toString() ?? ''

    if (process.env.DEV_MODE !== 'true') return { error: 'Dev mode disabled' }
    if (!DEV_ACCOUNT_UUIDS.includes(uuid as DevAccountUUID)) return { error: 'Invalid account' }

    const [user] = await db.select().from(users).where(eq(users.id, uuid))
    if (!user) return { error: 'Account not found — run db:seed:dev first' }

    const { token } = await createSession(user.id)
    cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)
    throw redirect(302, '/')
  },
}
