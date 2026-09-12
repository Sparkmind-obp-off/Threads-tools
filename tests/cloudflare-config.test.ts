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
    CLOUDFLARE_OAUTH_CLIENT_ID: 'client-id',
    CLOUDFLARE_OAUTH_CLIENT_SECRET: 'client-secret',
    CLOUDFLARE_OAUTH_SCOPES: 'official.pages.read official.pages.write',
    CF_ACCESS_TEAM_DOMAIN: 'owner.cloudflareaccess.com',
    CF_ACCESS_AUD: 'access-audience',
    OWNER_EMAIL: 'owner@example.com',
    ...overrides,
  }
}

function result(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, result: value }), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

describe('Phase 5.1 Production configuration contract', () => {
  it('classifies sensitive and safe values using Cloudflare binding types', () => {
    expect(productionVariableKinds).toEqual({
      THREADS_APP_ID: 'plain_text', THREADS_APP_SECRET: 'secret_text', THREADS_REDIRECT_URI: 'plain_text',
      THREADS_API_BASE_URL: 'plain_text', THREADS_API_VERSION: 'plain_text', SESSION_SECRET: 'secret_text',
    })
  })

  it('targets only Production, trims values, and preserves unrelated environment variables', () => {
    expect(buildProductionEnvironmentPatch({ THREADS_APP_ID: ' 123 ', THREADS_APP_SECRET: ' secret ' }, {
      UNRELATED: { type: 'plain_text', value: 'preserve-me' },
    })).toEqual({ deployment_configs: { production: { env_vars: {
      UNRELATED: { type: 'plain_text', value: 'preserve-me' },
      THREADS_APP_ID: { type: 'plain_text', value: '123' },
      THREADS_APP_SECRET: { type: 'secret_text', value: 'secret' },
    } } } })
  })

  it('normalizes values away and verifies required binding kinds', () => {
    const normalized = normalizeProjectConfiguration({ name: 'threads-tools', deployment_configs: { production: { env_vars: {
      THREADS_APP_ID: { type: 'plain_text', value: '123' },
      THREADS_APP_SECRET: { type: 'secret_text', value: 'never-return-this' },
    } } } })
    expect(normalized).toMatchObject({
      environment: 'production', projectName: 'threads-tools',
      readiness: { THREADS_APP_ID: 'configured', THREADS_APP_SECRET: 'configured', SESSION_SECRET: 'missing' },
      kinds: { THREADS_APP_ID: 'plain_text', THREADS_APP_SECRET: 'secret_text' },
    })
    expect(JSON.stringify(normalized)).not.toContain('never-return-this')
  })

  it('discovers accounts and Pages projects through official endpoints', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url))
      return String(url).includes('/pages/projects')
        ? result([{ name: 'threads-tools', subdomain: 'threads-tools.pages.dev', production_branch: 'main' }])
        : result([{ id: 'a'.repeat(32), name: 'Owner account' }])
    }) as unknown as typeof fetch
    const api = new CloudflarePagesApi('oauth-access', fetcher)
    expect(await api.listAccounts()).toEqual([{ id: 'a'.repeat(32), name: 'Owner account' }])
    expect(await api.listProjects('a'.repeat(32))).toEqual([{ name: 'threads-tools', subdomain: 'threads-tools.pages.dev', productionBranch: 'main' }])
    expect(urls[0]).toContain('/accounts?per_page=50')
    expect(urls[1]).toContain(`/accounts/${'a'.repeat(32)}/pages/projects?per_page=100`)
  })

  it('checks project ownership, preserves unrelated vars, PATCHes selected project, then re-reads', async () => {
    let patchBody = ''
    let getCount = 0
    const project = (updated = false) => ({ name: 'selected-project', deployment_configs: { production: { env_vars: {
      UNRELATED: { type: 'plain_text', value: 'keep' },
      ...(updated ? { THREADS_APP_SECRET: { type: 'secret_text', value: '' } } : {}),
    } } } })
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/pages/projects?per_page=100')) return result([{ name: 'selected-project' }])
      if (init?.method === 'PATCH') { patchBody = String(init.body); return result(project(true)) }
      getCount += 1
      return result(project(getCount > 1))
    }) as unknown as typeof fetch
    const status = await new CloudflarePagesApi('oauth-access', fetcher)
      .updateProduction('a'.repeat(32), 'selected-project', { THREADS_APP_SECRET: 'new-secret' })
    expect(patchBody).toContain('"UNRELATED":{"type":"plain_text","value":"keep"}')
    expect(patchBody).toContain('"THREADS_APP_SECRET":{"type":"secret_text","value":"new-secret"}')
    expect(status.readiness.THREADS_APP_SECRET).toBe('configured')
    expect(JSON.stringify(status)).not.toContain('new-secret')
    expect(JSON.stringify(status)).not.toContain('oauth-access')
  })

  it('rejects a project outside the authorized account boundary', async () => {
    const fetcher = vi.fn(async () => result([{ name: 'other-project' }])) as unknown as typeof fetch
    await expect(new CloudflarePagesApi('token', fetcher).verifyProjectBoundary('a'.repeat(32), 'threads-tools'))
      .rejects.toEqual(expect.objectContaining<Partial<CloudflarePagesApiError>>({ code: 'PROJECT_BOUNDARY_VIOLATION' }))
  })

  it.each([401, 403])('normalizes invalid or insufficient authorization (%s)', async (status) => {
    const fetcher = vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch
    await expect(new CloudflarePagesApi('expired', fetcher).listAccounts())
      .rejects.toEqual(expect.objectContaining<Partial<CloudflarePagesApiError>>({ code: 'AUTHORIZATION_INVALID' }))
  })

  it('returns a safe OAuth bootstrap state without exposing values', () => {
    const status = productionConfigurationStatus(environment({ CLOUDFLARE_OAUTH_CLIENT_SECRET: undefined }), 'https://owner.example/setup', [])
    expect(status).toMatchObject({
      bridge: { status: 'oauth_bootstrap_required', automatedWritesAvailable: false, callbackUrl: 'https://owner.example/auth/cloudflare/callback' },
      actions: {
        redirectUriSuggestion: 'https://owner.example/auth/threads/callback',
        accessDashboardUrl: 'https://one.dash.cloudflare.com/',
      },
    })
    expect(JSON.stringify(status)).not.toContain('threads-private-value')
    expect(JSON.stringify(status)).not.toContain('client-secret')
    expect(JSON.stringify(status)).not.toContain('s'.repeat(32))
  })
})

describe('Phase 5.1 route security and fallback', () => {
  it('rejects configuration writes without a valid signed owner assertion and never logs/returns secrets', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const secret = 'do-not-log-or-return-this'
    const response = await app.request('/api/configuration/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://threads-tools.pages.dev' },
      body: JSON.stringify({ THREADS_APP_ID: '12345', THREADS_APP_SECRET: secret }),
    }, environment())
    const payload = await response.text()
    expect(response.status).toBe(401)
    expect(payload).toContain('OWNER_AUTHORIZATION_REQUIRED')
    expect(payload).not.toContain(secret)
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret)
  })

  it('re-checks current runtime bindings with no-store safe status', async () => {
    const response = await app.request('/api/configuration', undefined, environment({ THREADS_APP_ID: undefined }))
    const payload = await response.json<Record<string, unknown>>()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(payload).toMatchObject({ status: 'not_configured', readiness: { threadsAppId: 'missing' } })
    expect(JSON.stringify(payload)).not.toContain('threads-private-value')
  })

  it('renders the actionable OAuth/project/secret configuration UI without credential values', async () => {
    const html = await (await app.request('/setup')).text()
    expect(html).toContain('Production Configuration Center')
    expect(html).toContain('Owner-authorized Pages access')
    expect(html).toContain('Cloudflare owner authorization')
    expect(html).toContain('Open Zero Trust Access')
    expect(html).toContain('Configure automatically')
    expect(html).toContain('Copy Redirect URI')
    expect(html).toContain('type="password"')
    expect(html).not.toContain('name="cloudflare_token"')
    expect(html).not.toContain('CLOUDFLARE_OAUTH_CLIENT_SECRET=')
  })
})
