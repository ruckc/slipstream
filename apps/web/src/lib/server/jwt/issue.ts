import { SignJWT } from 'jose'
import { getKeyPair } from './keys'

export interface ProjectTokenClaims {
  sub: string
  aud: string | string[]
  projectId: string
  permissions: string[]
  exp: number
  iat: number
}

export async function issueProjectToken(
  userId: string,
  projectId: string,
  permissions: string[],
  ttlSeconds = 300
): Promise<{ token: string; expiresAt: number }> {
  const { privateKey, publicKeyJwk } = await getKeyPair()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + ttlSeconds

  const token = await new SignJWT({ projectId, permissions })
    .setProtectedHeader({ alg: 'RS256', kid: publicKeyJwk.kid })
    .setSubject(userId)
    .setAudience(`agent:${projectId}`)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  return { token, expiresAt: exp * 1000 }
}
