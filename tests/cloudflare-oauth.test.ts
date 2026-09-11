import { describe, expect, it, vi } from 'vitest'
import { CloudflareOAuthClient, CloudflareOAuthService, type CloudflareOAuthStore } from '../src/cloudflare/oauth'

function memoryStore(): CloudflareOAuthStore & { state?: string; tokens?: { accessToken: string; refreshToken?: string } } {
  return {
    state: undefined,
    async createState(state) { this.state = state },
    async consumeState(state) { const valid = state === this.state; this.state = undefined; return valid },
    async saveCredential(tokens) { this.tokens = tokens },
    async getCredential() { return this.tokens ? { ...this.tokens } : null },
    async selectProject() {},
    async safeStatus() { return this.tokens ? { status: 'connected' } : { status: 'not_connected' } },
    async disconnect() { this.tokens = undefined },
  }
}

const config = {
  clientId: 'private-client-id', clientSecret: 'private-client-secret',
  redirectUri: 'https://threads-tools.pages.dev/auth/cloudflare/callback',
  scopes: ['scope-id-read', 'scope-id-write'],
}

describe('Cloudflare OAuth Authorization Code bridge', () => {
  it('constructs the documented authorization endpoint with exact configured scopes and strong state', async () => {
    const store = memoryStore()
    const url = new URL(await new CloudflareOAuthService(new CloudflareOAuthClient(config), store).start())
    expect(url.origin + url.pathname).toBe('https://dash.cloudflare.com/oauth2/auth')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(config.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('scope')).toBe('scope-id-read scope-id-write')
    expect(url.searchParams.get('state')).toBe(store.state)
    expect(store.state?.length).toBeGreaterThanOrEqual(40)
    expect(url.toString()).not.toContain(config.clientSecret)
  })

  it('rejects missing, invalid, expired, and replayed state before token exchange', async () => {
    const exchange = vi.fn()
    const client = { authorizationUrl: () => '', exchangeCode: exchange } as unknown as CloudflareOAuthClient
    const store = memoryStore()
    const service = new CloudflareOAuthService(client, store)
    await expect(service.callback({ code: 'code' })).rejects.toMatchObject({ code: 'CLOUDFLARE_STATE_INVALID' })
    store.state = 'valid-state'
    await expect(service.callback({ state: 'wrong', code: 'code' })).rejects.toMatchObject({ code: 'CLOUDFLARE_STATE_INVALID' })
    store.state = 'once'
    exchange.mockResolvedValue({ accessToken: 'token' })
    await service.callback({ state: 'once', code: 'code' })
    await expect(service.callback({ state: 'once', code: 'code' })).rejects.toMatchObject({ code: 'CLOUDFLARE_STATE_INVALID' })
  })

  it('rejects missing code after consuming valid state', async () => {
    const store = memoryStore(); store.state = 'valid'
    await expect(new CloudflareOAuthService(new CloudflareOAuthClient(config), store).callback({ state: 'valid' }))
      .rejects.toMatchObject({ code: 'CLOUDFLARE_CODE_INVALID' })
  })

  it('exchanges the code server-side with client_secret_basic and redacts credentials from output', async () => {
    let capturedUrl = ''; let capturedInit: RequestInit | undefined
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url); capturedInit = init
      return new Response(JSON.stringify({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: 'scope-id-write' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const tokens = await new CloudflareOAuthClient(config, fetcher).exchangeCode('authorization-code', new Date('2026-09-11T00:00:00Z'))
    expect(capturedUrl).toBe('https://dash.cloudflare.com/oauth2/token')
    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('private-client-id:private-client-secret')}`)
    expect(String(capturedInit?.body)).toContain('grant_type=authorization_code')
    expect(String(capturedInit?.body)).toContain('code=authorization-code')
    expect(tokens).toMatchObject({ accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: new Date('2026-09-11T01:00:00Z') })
    expect(JSON.stringify({ status: 'connected' })).not.toContain('access-secret')
  })

  it('normalizes token exchange failure without leaking upstream payload or client secret', async () => {
    const fetcher = vi.fn(async () => new Response('upstream-secret-detail', { status: 400 })) as unknown as typeof fetch
    const error = await new CloudflareOAuthClient(config, fetcher).exchangeCode('bad-code').catch((value) => value)
    expect(error).toMatchObject({ code: 'CLOUDFLARE_TOKEN_EXCHANGE_FAILED' })
    expect(JSON.stringify(error)).not.toContain('upstream-secret-detail')
    expect(JSON.stringify(error)).not.toContain(config.clientSecret)
  })
})
