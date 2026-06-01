export type Provider = 'google' | 'microsoft' | 'github'

export const PROVIDER_LABELS: Record<Provider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  github: 'GitHub',
}

export function getActiveProviders(): Provider[] {
  const active: Provider[] = []
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) active.push('google')
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) active.push('microsoft')
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) active.push('github')
  return active
}
