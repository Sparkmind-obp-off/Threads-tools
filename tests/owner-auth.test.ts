import { describe, expect, it, vi } from 'vitest'
import { assertSameOrigin, requireOwner } from '../src/auth/owner'

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function assertion(overrides: Record<string, unknown> = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey & { kid?: string }
  publicJwk.kid = 'test-key'
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid: 'test-key' }))
  const payload = base64Url(JSON.stringify({
    iss: 'https://owner.cloudflareaccess.com', aud: ['access-audience'], email: 'owner@example.com', exp: 2_000_000_000, ...overrides,
  }))
  const signed = `${header}.${payload}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed))
  return { token: `${signed}.${base64Url(new Uint8Array(signature))}`, publicJwk }
}

describe('owner authorization boundary', () => {
  it('cryptographically verifies Cloudflare Access issuer, audience, expiry, and exact owner email', async () => {
    const { token, publicJwk } = await assertion()
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
    await expect(requireOwner(token, {
      teamDomain: 'owner.cloudflareaccess.com', audience: 'other-audience, access-audience', ownerEmail: 'OWNER@example.com',
    }, fetcher, new Date('2026-09-11T00:00:00Z'))).resolves.toEqual({ email: 'owner@example.com' })
    expect(fetcher).toHaveBeenCalledWith('https://owner.cloudflareaccess.com/cdn-cgi/access/certs')
  })

  it('rejects missing assertions and non-owner claims', async () => {
    await expect(requireOwner(undefined, {
      teamDomain: 'owner.cloudflareaccess.com', audience: 'access-audience', ownerEmail: 'owner@example.com',
    })).rejects.toMatchObject({ code: 'OWNER_AUTHORIZATION_REQUIRED' })
    const { token, publicJwk } = await assertion({ email: 'other@example.com' })
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })) as unknown as typeof fetch
    await expect(requireOwner(token, {
      teamDomain: 'owner.cloudflareaccess.com', audience: 'access-audience', ownerEmail: 'owner@example.com',
    }, fetcher)).rejects.toMatchObject({ code: 'OWNER_AUTHORIZATION_REQUIRED' })
  })

  it('requires exact same-origin POST requests', () => {
    expect(() => assertSameOrigin('https://threads-tools.pages.dev/api/configuration/apply', 'https://threads-tools.pages.dev')).not.toThrow()
    expect(() => assertSameOrigin('https://threads-tools.pages.dev/api/configuration/apply', 'https://attacker.example')).toThrowError(expect.objectContaining({ code: 'CSRF_REJECTED' }))
  })
})
