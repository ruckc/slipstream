import {
  discovery,
  calculatePKCECodeChallenge,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  ClientSecretPost,
  Configuration,
  type ServerMetadata,
} from 'openid-client'
import type { Provider } from './providers'

// ---------------------------------------------------------------------------
// Module-level client cache
// ---------------------------------------------------------------------------
const clientCache = new Map<Provider, Configuration>()

function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing environment variable: ${key}`)
  return val
}

export async function getClient(provider: Provider): Promise<Configuration> {
  const cached = clientCache.get(provider)
  if (cached) return cached

  let config: Configuration

  if (provider === 'google') {
    config = await discovery(
      new URL('https://accounts.google.com'),
      getEnv('GOOGLE_CLIENT_ID'),
      getEnv('GOOGLE_CLIENT_SECRET')
    )
  } else if (provider === 'microsoft') {
    config = await discovery(
      new URL('https://login.microsoftonline.com/common/v2.0'),
      getEnv('MICROSOFT_CLIENT_ID'),
      getEnv('MICROSOFT_CLIENT_SECRET')
    )
  } else if (provider === 'github') {
    // GitHub does not support OIDC discovery — configure manually
    const server: ServerMetadata = {
      issuer: 'https://github.com',
      authorization_endpoint: 'https://github.com/login/oauth/authorize',
      token_endpoint: 'https://github.com/login/oauth/access_token',
      userinfo_endpoint: 'https://api.github.com/user',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    }
    config = new Configuration(
      server,
      getEnv('GITHUB_CLIENT_ID'),
      { client_secret: getEnv('GITHUB_CLIENT_SECRET') },
      ClientSecretPost(getEnv('GITHUB_CLIENT_SECRET'))
    )
  } else {
    throw new Error(`Unknown provider: ${provider}`)
  }

  clientCache.set(provider, config)
  return config
}

// ---------------------------------------------------------------------------
// Scopes per provider
// ---------------------------------------------------------------------------
function scopesFor(provider: Provider): string {
  if (provider === 'github') return 'user:email read:user'
  return 'openid email profile'
}

// ---------------------------------------------------------------------------
// Generate authorization URL with PKCE
// ---------------------------------------------------------------------------
export async function generateAuthorizationUrl(
  provider: Provider,
  redirectUri: string,
  state: string,
  codeVerifier: string
): Promise<string> {
  const config = await getClient(provider)
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier)

  const url = buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: scopesFor(provider),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return url.href
}

// ---------------------------------------------------------------------------
// Handle callback and extract user profile
// ---------------------------------------------------------------------------
export async function handleCallback(
  provider: Provider,
  redirectUri: string,
  currentUrl: URL,
  state: string,
  codeVerifier: string
): Promise<{
  email: string
  name: string
  avatarUrl: string | null
  subject: string
}> {
  const config = await getClient(provider)

  const tokens = await authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
  })

  if (provider === 'github') {
    return fetchGitHubProfile(tokens.access_token!)
  }

  // Google / Microsoft — use ID token claims
  const claims = tokens.claims()
  if (!claims) throw new Error('No claims in token response')

  const email = (claims.email as string | undefined) ?? ''
  const name = (claims.name as string | undefined) ?? email
  const avatarUrl = (claims.picture as string | undefined) ?? null

  return {
    email,
    name,
    avatarUrl,
    subject: claims.sub,
  }
}

// ---------------------------------------------------------------------------
// GitHub-specific profile fetch (no OIDC userinfo)
// ---------------------------------------------------------------------------
async function fetchGitHubProfile(accessToken: string): Promise<{
  email: string
  name: string
  avatarUrl: string | null
  subject: string
}> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'slipstream-auth',
  }

  const userRes = await fetch('https://api.github.com/user', { headers })
  if (!userRes.ok) {
    throw new Error(`GitHub /user request failed: ${userRes.status}`)
  }
  const user = (await userRes.json()) as {
    id: number
    login: string
    name: string | null
    email: string | null
    avatar_url: string | null
  }

  let email: string | null = user.email

  // If primary email is null, fetch /user/emails
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', { headers })
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string
        primary: boolean
        verified: boolean
      }>
      const primary = emails.find((e) => e.primary && e.verified)
      const anyVerified = emails.find((e) => e.verified)
      email = (primary ?? anyVerified)?.email ?? null
    }
  }

  if (!email) {
    throw new Error('Could not retrieve email from GitHub account')
  }

  return {
    email,
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url ?? null,
    subject: String(user.id),
  }
}
