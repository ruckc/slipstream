import { redirect } from '@sveltejs/kit'
import { randomBytes } from 'crypto'
import type { RequestHandler } from './$types'
import { getActiveProviders, type Provider } from '$lib/server/auth/providers'
import { generateAuthorizationUrl } from '$lib/server/auth/oidc'

function generateState(): string {
  return randomBytes(16).toString('hex')
}

function generateCodeVerifier(): string {
  // 43 URL-safe random characters (matches PKCE spec minimum)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = randomBytes(43)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export const GET: RequestHandler = async ({ params, cookies, url }) => {
  const provider = params.provider as Provider
  const activeProviders = getActiveProviders()

  if (!activeProviders.includes(provider)) {
    throw redirect(302, '/auth/login')
  }

  const state = generateState()
  const codeVerifier = generateCodeVerifier()

  // Store state + verifier in a short-lived cookie
  cookies.set(
    'oauth_state',
    JSON.stringify({ state, codeVerifier, provider }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10, // 10 minutes
    },
  )

  const redirectUri = `${url.origin}/auth/callback/${provider}`
  const authUrl = await generateAuthorizationUrl(provider, redirectUri, state, codeVerifier)

  throw redirect(302, authUrl)
}
