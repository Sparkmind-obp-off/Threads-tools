import { describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { DaytonaClient } from '../src/sparkpod/daytona-routes'

describe('Daytona outbound preflight', () => {
  it('reports reachable when the authenticated API receives HTTP and never creates a sandbox', async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [] }, { status: 200 })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    const result = await client.preflight()

    expect(result).toMatchObject({ reachable: true, classification: 'reachable', providerStatus: 200 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://app.daytona.io/api/sandbox?limit=1', expect.objectContaining({ method: 'GET' }))
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('/sandbox'), expect.objectContaining({ method: 'POST' }))
    expect(JSON.stringify(result)).not.toContain('server-only-secret-value')
  })

  it.each([401, 403])('reports authentication separately when the endpoint responds %i', async (status) => {
    const fetcher = vi.fn(async () => Response.json({ error: { code: 'invalid_token', message: 'credential rejected' } }, { status })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    await expect(client.preflight()).resolves.toMatchObject({
      reachable: true, classification: 'authentication', providerStatus: status, providerCode: 'invalid_token', diagnostic: 'credential rejected',
    })
  })

  it.each([400, 404, 422])('reports endpoint or contract configuration separately for HTTP %i', async (status) => {
    const fetcher = vi.fn(async () => Response.json({ code: 'invalid_request', message: 'endpoint contract rejected' }, { status })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    await expect(client.preflight()).resolves.toMatchObject({
      reachable: true, classification: 'configuration', providerStatus: status, providerCode: 'invalid_request', diagnostic: 'endpoint contract rejected',
    })
  })

  it.each([429, 500, 503])('reports transient provider failure for HTTP %i without calling it network failure', async (status) => {
    const fetcher = vi.fn(async () => new Response('upstream unavailable', { status })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    await expect(client.preflight()).resolves.toMatchObject({
      reachable: true, classification: 'provider', providerStatus: status, diagnostic: 'upstream unavailable',
    })
  })

  it('reports runtime network failure when fetch itself fails', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    await expect(client.preflight()).resolves.toMatchObject({ reachable: false, classification: 'network' })
  })

  it('reports timeout distinctly and does not create a sandbox', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new TypeError('The operation was aborted')), { once: true })
    })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher, 5)

    await expect(client.preflight()).resolves.toMatchObject({ reachable: false, classification: 'timeout' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps owner authentication required on the preflight and lifecycle routes', async () => {
    const env = {
      CF_ACCESS_TEAM_DOMAIN: 'owner.cloudflareaccess.com',
      CF_ACCESS_AUD: 'access-audience',
      OWNER_EMAIL: 'owner@example.com',
      DAYTONA_API_KEY: 'server-only-secret-value',
    } as never
    const [preflight, lifecycle] = await Promise.all([
      app.request('/api/sparkpod/daytona/preflight', { method: 'POST', headers: { Origin: 'https://app.example.com' } }, env),
      app.request('/api/sparkpod/daytona/test', { method: 'POST', headers: { Origin: 'https://app.example.com' } }, env),
    ])
    expect(preflight.status).toBe(401)
    expect(lifecycle.status).toBe(401)
    expect(JSON.stringify(await preflight.json())).not.toContain('server-only-secret-value')
    expect(JSON.stringify(await lifecycle.json())).not.toContain('server-only-secret-value')
  })
})
