import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import {
  buildProductionEnvironmentPatch,
  CloudflarePagesApi,
  CloudflarePagesApiError,
  normalizeProjectConfiguration,
  productionVariableKinds,
} from '../src/cloudflare/pages'
import { productionConfigurationStatus } from '../src/config/production'
import type { Env } from '../src/config/env'

function environment(overrides: Partial<Env> = {}): Env {
  const statement = {
    bind() { return statement },
    async first() { return null },
    async run() { return { meta: { changes: 0 } } },
    async all() { return { results: [] } },
  }
  return {
    DB: { prepare: () => statement } as unknown as D1Database,
    THREADS_APP_ID: '123456',
    THREADS_APP_SECRET: 'threads-private-value',
    THREADS_REDIRECT_URI: 'https://threads-tools.pages.dev/auth/threads/callback',
    THREADS_API_BASE_URL: 'https://graph.threads.com',
    THREADS_API_VERSION: 'v1.0',
    SESSION_SECRET: 's'.repeat(32),
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('Phase 5.1 Production configuration contract', () => {
  it('classifies sensitive and safe values using Cloudflare binding types', () => {
    expect(productionVariableKinds).toEqual({
      THREADS_APP_ID: 'plain_text',
      THREADS_APP_SECRET: 'secret_text',
      THREADS_REDIRECT_URI: 'plain_text',
      THREADS_API_BASE_URL: 'plain_text',
      THREADS_API_VERSION: 'plain_text',
      SESSION_SECRET: 'secret_text',
    })
  })

  it('targets only Production and constructs the documented Pages PATCH payload', () => {
    expect(buildProductionEnvironmentPatch({
      THREADS_APP_ID: ' 123 ',
      THREADS_APP_SECRET: ' secret ',
      SESSION_SECRET: ' session-key ',
    })).toEqual({
      deployment_configs: {
        production: {
          env_vars: {
            THREADS_APP_ID: { type: 'plain_text', value: '123' },
            THREADS_APP_SECRET: { type: 'secret_text', value: 'secret' },
            SESSION_SECRET: { type: 'secret_text', value: 'session-key' },
          },
        },
      },
    })
  })

  it('normalizes Cloudflare responses without returning values', () => {
    const normalized = normalizeProjectConfiguration({
      name: 'threads-tools',
      deployment_configs: { production: { env_vars: {
        THREADS_APP_ID: { type: 'plain_text', value: '123' },
        THREADS_APP_SECRET: { type: 'secret_text', value: 'never-return-this' },
      } } },
    })
    expect(normalized).toMatchObject({
      environment: 'production', projectName: 'threads-tools',
      readiness: { THREADS_APP_ID: 'configured', THREADS_APP_SECRET: 'configured', SESSION_SECRET: 'missing' },
    })
    expect(JSON.stringify(normalized)).not.toContain('never-return-this')
  })

  it('uses the official account Pages project PATCH endpoint and returns safe status', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url); capturedInit = init
      return new Response(JSON.stringify({ success: true, result: {
        name: 'threads-tools', deployment_configs: { production: { env_vars: {
          THREADS_APP_SECRET: { type: 'secret_text', value: 'redacted-by-cloudflare' },
        } } },
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch
    const result = await new CloudflarePagesApi('account 1', 'cloudflare-token', fetcher).updateProduction({ THREADS_APP_SECRET: 'new-secret' })
    expect(capturedUrl).toBe('https://api.cloudflare.com/client/v4/accounts/account%201/pages/projects/threads-tools')
    expect(capturedInit?.method).toBe('PATCH')
    expect(capturedInit?.body).toContain('"type":"secret_text"')
    expect(result.readiness.THREADS_APP_SECRET).toBe('configured')
    expect(JSON.stringify(result)).not.toContain('new-secret')
    expect(JSON.stringify(result)).not.toContain('cloudflare-token')
  })

  it.each([401, 403])('normalizes invalid or insufficient Cloudflare authorization (%s)', async (status) => {
    const fetcher = vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch
    await expect(new CloudflarePagesApi('account', 'expired', fetcher).updateProduction({ THREADS_APP_ID: '123' }))
      .rejects.toEqual(expect.objectContaining<Partial<CloudflarePagesApiError>>({ code: 'AUTHORIZATION_INVALID' }))
  })

  it('normalizes other Cloudflare API failures without exposing provider payloads', async () => {
    const fetcher = vi.fn(async () => new Response('sensitive upstream details', { status: 500 })) as unknown as typeof fetch
    await expect(new CloudflarePagesApi('account', 'token', fetcher).updateProduction({ THREADS_APP_ID: '123' }))
      .rejects.toEqual(expect.objectContaining<Partial<CloudflarePagesApiError>>({ code: 'CLOUDFLARE_API_FAILURE' }))
  })

  it('returns a complete safe manual fallback state and redirect suggestion', () => {
    const status = productionConfigurationStatus(environment({ THREADS_APP_SECRET: undefined }), 'https://owner.example/setup', ['Threads App Secret'])
    expect(status).toMatchObject({
      status: 'not_configured', environment: 'production', projectName: 'threads-tools',
      readiness: { threadsAppSecret: 'missing', apiBaseUrl: 'configured' },
      bridge: { status: 'manual_setup_required', automatedWritesAvailable: false },
      actions: { recheckUrl: '/api/configuration', redirectUriSuggestion: 'https://owner.example/auth/threads/callback' },
    })
    expect(JSON.stringify(status)).not.toContain('threads-private-value')
    expect(JSON.stringify(status)).not.toContain('s'.repeat(32))
  })
})

describe('Phase 5.1 route security and fallback', () => {
  it('rejects unauthenticated configuration writes and never logs or returns submitted secrets', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const secret = 'do-not-log-or-return-this'
    const response = await app.request('/api/configuration/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ THREADS_APP_SECRET: secret }),
    }, environment())
    const payload = await response.text()
    expect(response.status).toBe(403)
    expect(payload).toContain('OWNER_AUTHORIZATION_REQUIRED')
    expect(payload).not.toContain(secret)
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret)
  })

  it('re-checks current bindings with no-store safe status', async () => {
    const response = await app.request('/api/configuration', undefined, environment({ THREADS_APP_ID: undefined }))
    const payload = await response.json<Record<string, unknown>>()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(payload).toMatchObject({ status: 'not_configured', readiness: { threadsAppId: 'missing' } })
    expect(JSON.stringify(payload)).not.toContain('threads-private-value')
  })

  it('renders actionable manual steps, exact binding names, safe copy action, and no credential form', async () => {
    const html = await (await app.request('/setup')).text()
    expect(html).toContain('Production Configuration Center')
    expect(html).toContain('Manual action')
    expect(html).toContain('Re-check Configuration')
    expect(html).toContain('Copy Redirect URI')
    expect(html).toContain('THREADS_APP_SECRET')
    expect(html).toContain('Encrypted Secret')
    expect(html).toContain('Cloudflare Access')
    expect(html).not.toContain('name="cloudflare_token"')
    expect(html).not.toContain('type="password"')
  })
})
