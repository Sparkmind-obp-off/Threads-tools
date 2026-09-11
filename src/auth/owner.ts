import { AppError } from '../domain/types'

interface AccessPayload {
  aud?: string | string[]
  email?: string
  exp?: number
  iss?: string
}

interface JwkSet { keys?: JsonWebKey[] }
const keyCache = new Map<string, { expiresAt: number; keys: JsonWebKey[] }>()

function decodeJsonPart(value: string): Record<string, unknown> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return JSON.parse(decoded) as Record<string, unknown>
}

async function accessKeys(teamDomain: string, fetcher: typeof fetch): Promise<JsonWebKey[]> {
  const cached = keyCache.get(teamDomain)
  if (cached && cached.expiresAt > Date.now()) return cached.keys
  const response = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!response.ok) throw new AppError('OWNER_AUTHORIZATION_REQUIRED', 'Owner authorization could not be verified.', 401)
  const body = await response.json() as JwkSet
  const keys = Array.isArray(body.keys) ? body.keys : []
  if (!keys.length) throw new AppError('OWNER_AUTHORIZATION_REQUIRED', 'Owner authorization could not be verified.', 401)
  keyCache.set(teamDomain, { expiresAt: Date.now() + 5 * 60 * 1000, keys })
  return keys
}

function decodeSignature(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
}

export interface OwnerAuthorizationConfig {
  teamDomain?: string
  audience?: string
  ownerEmail?: string
}

export async function requireOwner(
  assertion: string | undefined,
  config: OwnerAuthorizationConfig,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<{ email: string }> {
  const teamDomain = config.teamDomain?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  const audience = config.audience?.trim()
  const ownerEmail = config.ownerEmail?.trim().toLowerCase()
  if (!teamDomain || !audience || !ownerEmail) {
    throw new AppError('OWNER_AUTHORIZATION_NOT_CONFIGURED', 'Cloudflare Access owner verification is not configured.', 503)
  }
  if (!assertion) throw new AppError('OWNER_AUTHORIZATION_REQUIRED', 'Owner authorization is required.', 401)
  const parts = assertion.split('.')
  if (parts.length !== 3) throw new AppError('OWNER_AUTHORIZATION_REQUIRED', 'Owner authorization is invalid.', 401)

  try {
    const header = decodeJsonPart(parts[0])
    const payload = decodeJsonPart(parts[1]) as AccessPayload
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported token')
    const jwk = (await accessKeys(teamDomain, fetcher)).find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid)
    if (!jwk) throw new Error('Signing key unavailable')
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, decodeSignature(parts[2]).buffer as ArrayBuffer, new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    const issuer = `https://${teamDomain}`
    if (!valid || payload.iss !== issuer || !tokenAudiences.includes(audience) || !payload.exp || payload.exp <= Math.floor(now.getTime() / 1000)) throw new Error('Invalid claims')
    if (payload.email?.toLowerCase() !== ownerEmail) throw new Error('Not owner')
    return { email: ownerEmail }
  } catch {
    throw new AppError('OWNER_AUTHORIZATION_REQUIRED', 'Owner authorization is invalid or expired.', 401)
  }
}

export function assertSameOrigin(requestUrl: string, origin: string | undefined): void {
  if (!origin || origin !== new URL(requestUrl).origin) throw new AppError('CSRF_REJECTED', 'The request origin could not be verified.', 403)
}
