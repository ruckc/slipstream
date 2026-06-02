import { redirect } from '@sveltejs/kit'
import { randomUUID } from 'crypto'
import { eq, and } from 'drizzle-orm'
import type { RequestHandler } from './$types'
import { db, users, namespaces, oidcConnections } from '$lib/server/db'
import { handleCallback } from '$lib/server/auth/oidc'
import {
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from '$lib/server/auth/session'
import { getActiveProviders, type Provider } from '$lib/server/auth/providers'

const LOGIN_ERROR_URL = '/auth/login?error=auth_failed'

function clearOAuthCookie(cookies: Parameters<RequestHandler>[0]['cookies']): void {
  cookies.delete('oauth_state', { path: '/' })
}

// Derive a namespace slug from an email local-part:
// lowercase, replace non-alphanumeric runs with '-', trim dashes, max 39 chars
function slugifyEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39)
}

// Ensure slug is unique in namespaces table; append -N if taken
async function uniqueSlug(base: string): Promise<string> {
  const existing = await db
    .select({ slug: namespaces.slug })
    .from(namespaces)
    .where(eq(namespaces.slug, base))
    .limit(1)

  if (existing.length === 0) return base

  let n = 2
  while (true) {
    const candidate = `${base.slice(0, 36)}-${n}`
    const taken = await db
      .select({ slug: namespaces.slug })
      .from(namespaces)
      .where(eq(namespaces.slug, candidate))
      .limit(1)
    if (taken.length === 0) return candidate
    n++
  }
}

export const GET: RequestHandler = async ({ params, cookies, url }) => {
  const provider = params.provider as Provider
  const activeProviders = getActiveProviders()

  if (!activeProviders.includes(provider)) {
    throw redirect(302, LOGIN_ERROR_URL)
  }

  // Read and validate the oauth_state cookie
  const rawCookie = cookies.get('oauth_state')
  clearOAuthCookie(cookies)

  if (!rawCookie) {
    throw redirect(302, LOGIN_ERROR_URL)
  }

  let oauthState: { state: string; codeVerifier: string; provider: string }
  try {
    oauthState = JSON.parse(rawCookie)
  } catch {
    throw redirect(302, LOGIN_ERROR_URL)
  }

  const urlState = url.searchParams.get('state')
  if (!urlState || urlState !== oauthState.state || oauthState.provider !== provider) {
    throw redirect(302, LOGIN_ERROR_URL)
  }

  let profile: Awaited<ReturnType<typeof handleCallback>>

  try {
    const redirectUri = `${url.origin}/auth/callback/${provider}`
    profile = await handleCallback(
      provider,
      redirectUri,
      url,
      oauthState.state,
      oauthState.codeVerifier
    )
  } catch (err) {
    console.error(`[auth/callback/${provider}] OIDC error:`, err)
    throw redirect(302, LOGIN_ERROR_URL)
  }

  try {
    // -----------------------------------------------------------------------
    // Upsert logic
    // -----------------------------------------------------------------------
    let userId: string | null = null

    // 1. Look up existing OIDC connection
    const [existingConn] = await db
      .select()
      .from(oidcConnections)
      .where(
        and(eq(oidcConnections.provider, provider), eq(oidcConnections.subject, profile.subject))
      )
      .limit(1)

    if (existingConn) {
      userId = existingConn.userId
    } else {
      // 2. Look up user by email
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, profile.email))
        .limit(1)

      if (existingUser) {
        userId = existingUser.id
        // Link this OIDC connection to the existing user
        await db.insert(oidcConnections).values({
          userId,
          provider,
          subject: profile.subject,
          email: profile.email,
        })
      } else {
        // 3. Brand-new user: create namespace, user, oidc_connection
        const baseSlug = slugifyEmail(profile.email)
        const slug = await uniqueSlug(baseSlug)
        const k8sNamespace = `u-${slug}`

        const [namespace] = await db
          .insert(namespaces)
          .values({ slug, type: 'user', k8sNamespace })
          .returning()

        const newUserId = randomUUID()
        await db.insert(users).values({
          id: newUserId,
          namespaceId: namespace.id,
          email: profile.email,
          displayName: profile.name,
          avatarUrl: profile.avatarUrl,
        })

        await db.insert(oidcConnections).values({
          userId: newUserId,
          provider,
          subject: profile.subject,
          email: profile.email,
        })

        userId = newUserId
      }
    }

    // -----------------------------------------------------------------------
    // Create session and set cookie
    // -----------------------------------------------------------------------
    const { token } = await createSession(userId!)
    cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)
  } catch (err) {
    console.error(`[auth/callback/${provider}] DB error:`, err)
    throw redirect(302, LOGIN_ERROR_URL)
  }

  throw redirect(302, '/')
}
