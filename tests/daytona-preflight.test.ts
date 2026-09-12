import { describe, expect, it, vi } from 'vitest'
import { DaytonaClient } from '../src/sparkpod/daytona-routes'

describe('Daytona outbound preflight', () => {
  it('reports reachable when Cloudflare receives an HTTP response and never creates a sandbox', async () => {
    const fetcher = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    const result = await client.preflight()

    expect(result).toMatchObject({ reachable: true, classification: 'reachable', providerStatus: 404 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://app.daytona.io/api', expect.objectContaining({ method: 'GET' }))
    expect(JSON.stringify(result)).not.toContain('server-only-secret-value')
  })

  it('reports authentication separately when the endpoint responds 401', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { code: 'invalid_token', message: 'credential rejected' } }, { status: 401 })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    await expect(client.preflight()).resolves.toMatchObject({
      reachable: true, classification: 'authentication', providerStatus: 401, providerCode: 'invalid_token', diagnostic: 'credential rejected',
    })
  })

  it('reports provider failure for 5xx without misclassifying it as network failure', async () => {
    const fetcher = vi.fn(async () => new Response('upstream unavailable', { status: 503 })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    await expect(client.preflight()).resolves.toMatchObject({
      reachable: true, classification: 'provider', providerStatus: 503, diagnostic: 'upstream unavailable',
    })
  })

  it('reports runtime network failure when fetch itself fails', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)

    await expect(client.preflight()).resolves.toMatchObject({ reachable: false, classification: 'network' })
  })

  it('reports timeout distinctly and does not create a sandbox', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher, 5)

    await expect(client.preflight()).resolves.toMatchObject({ reachable: false, classification: 'timeout' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
