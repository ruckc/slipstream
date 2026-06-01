import { generateKeyPair, exportJWK, exportPKCS8, importPKCS8 } from 'jose'

export interface KeyPair {
  privateKey: CryptoKey
  publicKeyJwk: JsonWebKey & { kid: string; alg: string; use: string }
}

let keyPairPromise: Promise<KeyPair> | null = null

export function getKeyPair(): Promise<KeyPair> {
  if (!keyPairPromise) {
    keyPairPromise = initKeys()
  }
  return keyPairPromise
}

async function initKeys(): Promise<KeyPair> {
  const envKey = process.env.K8S_JWT_PRIVATE_KEY

  if (envKey) {
    // Load from env var: base64-encoded PKCS8 PEM
    const pkcs8 = Buffer.from(envKey, 'base64').toString('utf-8')
    const privateKey = await importPKCS8(pkcs8, 'RS256')

    // To get the public JWK we need the public key. Re-export the private key
    // as PKCS8, then use SubtleCrypto to import as a key pair so we can
    // export the public portion.
    const pkcs8Pem = await exportPKCS8(privateKey)
    // Strip PEM headers and decode
    const b64 = pkcs8Pem
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '')
    const der = Uint8Array.from(Buffer.from(b64, 'base64'))

    const importedPrivate = await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['sign']
    )

    // Derive the public key via export/re-import trick — export as JWK, strip
    // private fields, then import as public key
    const privateJwk = await crypto.subtle.exportKey('jwk', importedPrivate)
    // Remove private key fields to get public JWK
    const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicFields } = privateJwk

    const publicKeyJwk = {
      ...publicFields,
      kid: 'slipstream-1',
      alg: 'RS256',
      use: 'sig',
    } as JsonWebKey & { kid: string; alg: string; use: string }

    return { privateKey, publicKeyJwk }
  }

  // Generate a new key pair (dev / single-replica mode)
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const publicKeyJwk = {
    ...(await exportJWK(publicKey)),
    kid: 'slipstream-1',
    alg: 'RS256',
    use: 'sig',
  } as JsonWebKey & { kid: string; alg: string; use: string }

  return { privateKey, publicKeyJwk }
}

export async function getJwks(): Promise<{ keys: object[] }> {
  const { publicKeyJwk } = await getKeyPair()
  return { keys: [publicKeyJwk] }
}
