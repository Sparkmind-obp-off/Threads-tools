import { describe, expect, it, vi } from 'vitest'
import { DaytonaClient, jsonError, normalizeDaytonaFailure, verifyDaytonaConnection, type TestSteps } from '../src/sparkpod/daytona-routes'

function freshSteps(): TestSteps {
  return {
    sandboxCreated: 'not_started', sandboxReady: 'not_started', commandExecuted: 'not_started',
    outputVerified: 'not_started', sandboxCleanedUp: 'not_started',
  }
}

describe('SparkPod Daytona failure contract', () => {
  it('uses the server credential for the bounded create, execute, and cleanup API flow', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/sandbox') && init?.method === 'POST') {
        return Response.json({ id: 'sandbox-1', state: 'started', toolboxProxyUrl: 'https://proxy.app.daytona.io/toolbox' })
      }
      if (url.endsWith('/process/execute')) return Response.json({ exitCode: 0, result: 'SparkPod OK\n' })
      if (url.endsWith('/sandbox/sandbox-1') && init?.method === 'DELETE') return Response.json({ id: 'sandbox-1', state: 'destroyed' })
      if (url.endsWith('/sandbox/sandbox-1')) return Response.json({ id: 'sandbox-1', state: 'destroyed' })
      return new Response('{}', { status: 404 })
    }
    const client = new DaytonaClient('server-only-secret', 'https://app.daytona.io/api', 'us', fetcher as typeof fetch)
    const created = await client.create()
    const sandbox = await client.waitUntilStarted(created)
    expect(await client.execute(sandbox)).toMatchObject({ exitCode: 0, result: 'SparkPod OK\n' })
    await client.delete(sandbox)

    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['POST', 'https://app.daytona.io/api/sandbox'],
      ['POST', 'https://proxy.app.daytona.io/toolbox/sandbox-1/process/execute'],
      ['DELETE', 'https://app.daytona.io/api/sandbox/sandbox-1'],
      ['GET', 'https://app.daytona.io/api/sandbox/sandbox-1'],
    ])
    expect(calls.every((call) => new Headers(call.init?.headers).get('Authorization') === 'Bearer server-only-secret')).toBe(true)
    expect(String(calls[0].init?.body)).toContain('"ttlMinutes":10')
    expect(String(calls[0].init?.body)).toContain('"env":{}')
    expect(String(calls[0].init?.body)).toContain('"code-toolbox-language":"typescript"')
  })

  it('returns only the safe boolean verification contract after create, execute, and confirmed cleanup', async () => {
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/sandbox') && init?.method === 'POST') return Response.json({ id: 'sandbox-2', state: 'started', toolboxProxyUrl: 'https://proxy.app.daytona.io/toolbox' })
      if (url.endsWith('/process/execute')) return Response.json({ exitCode: 0, result: 'SparkPod OK\n' })
      if (url.endsWith('/sandbox/sandbox-2') && init?.method === 'DELETE') return Response.json({ id: 'sandbox-2', state: 'destroying' })
      if (url.endsWith('/sandbox/sandbox-2')) return new Response('{}', { status: 404 })
      return new Response('{}', { status: 500 })
    }
    const steps: TestSteps = {
      sandboxCreated: 'not_started', sandboxReady: 'not_started', commandExecuted: 'not_started',
      outputVerified: 'not_started', sandboxCleanedUp: 'not_started',
    }
    const result = await verifyDaytonaConnection(new DaytonaClient('server-only-secret', 'https://app.daytona.io/api', 'us', fetcher as typeof fetch), steps)

    expect(result).toEqual({
      status: 'connected',
      provider: 'daytona',
      sandboxCreated: true,
      sandboxReady: true,
      commandExecuted: true,
      outputVerified: true,
      sandboxCleanedUp: true,
    })
    expect(JSON.stringify(result)).not.toContain('server-only-secret')
    expect(JSON.stringify(result)).not.toContain('SparkPod OK')
  })

  it('cleans up a sandbox even when it fails while waiting to start', async () => {
    const calls: Array<[string | undefined, string]> = []
    let deleted = false
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push([init?.method, url])
      if (url.endsWith('/sandbox') && init?.method === 'POST') return Response.json({ id: 'sandbox-3', state: 'creating' })
      if (url.endsWith('/sandbox/sandbox-3') && init?.method === 'DELETE') {
        deleted = true
        return Response.json({ id: 'sandbox-3', state: 'destroying' })
      }
      if (url.endsWith('/sandbox/sandbox-3') && deleted) return new Response('{}', { status: 404 })
      if (url.endsWith('/sandbox/sandbox-3')) return Response.json({ id: 'sandbox-3', state: 'error' })
      return new Response('{}', { status: 500 })
    }
    const steps: TestSteps = {
      sandboxCreated: 'not_started', sandboxReady: 'not_started', commandExecuted: 'not_started',
      outputVerified: 'not_started', sandboxCleanedUp: 'not_started',
    }
    const promise = verifyDaytonaConnection(new DaytonaClient('server-only-secret', 'https://app.daytona.io/api', 'us', fetcher as typeof fetch), steps)

    await expect(promise).rejects.toMatchObject({ code: 'SPARKPOD_SANDBOX_READINESS_FAILED' })
    expect(calls).toContainEqual(['DELETE', 'https://app.daytona.io/api/sandbox/sandbox-3'])
    expect(steps).toEqual({
      sandboxCreated: 'completed', sandboxReady: 'failed', commandExecuted: 'not_started',
      outputVerified: 'not_started', sandboxCleanedUp: 'completed',
    })
  })

  it('distinguishes deterministic output verification failure and still cleans up', async () => {
    let deleted = false
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/sandbox') && init?.method === 'POST') return Response.json({ id: 'sandbox-4', state: 'started', toolboxProxyUrl: 'https://proxy.app.daytona.io/toolbox' })
      if (url.endsWith('/process/execute')) return Response.json({ exitCode: 0, result: 'unexpected output' })
      if (url.endsWith('/sandbox/sandbox-4') && init?.method === 'DELETE') { deleted = true; return Response.json({ state: 'destroying' }) }
      if (url.endsWith('/sandbox/sandbox-4') && deleted) return new Response('{}', { status: 404 })
      return new Response('{}', { status: 500 })
    }
    const steps: TestSteps = {
      sandboxCreated: 'not_started', sandboxReady: 'not_started', commandExecuted: 'not_started',
      outputVerified: 'not_started', sandboxCleanedUp: 'not_started',
    }

    await expect(verifyDaytonaConnection(new DaytonaClient('server-only-secret', 'https://app.daytona.io/api', 'us', fetcher as typeof fetch), steps))
      .rejects.toMatchObject({ code: 'SPARKPOD_OUTPUT_VERIFICATION_FAILED' })
    expect(steps).toEqual({
      sandboxCreated: 'completed', sandboxReady: 'completed', commandExecuted: 'completed',
      outputVerified: 'failed', sandboxCleanedUp: 'completed',
    })
  })

  it('bounds individual Daytona requests with an abort signal and normalizes timeout as retryable', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret', 'https://app.daytona.io/api', 'us', fetcher, 5)

    let failure: unknown
    try { await client.create() } catch (error) { failure = error }
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(normalizeDaytonaFailure(failure, 'create')).toMatchObject({ code: 'SPARKPOD_DAYTONA_TIMEOUT', status: 504, retryable: true })
  })

  it.each([401, 403])('preserves safe %i authentication diagnostics and never returns credentials', async (status) => {
    const secret = 'server-only-secret-value'
    const fetcher = vi.fn(async () => Response.json({
      error: { code: 'invalid_token', message: `Credential rejected for Bearer ${secret}` },
    }, { status })) as unknown as typeof fetch
    const client = new DaytonaClient(secret, 'https://app.daytona.io/api', 'us', fetcher)
    const steps = freshSteps()
    let failure: unknown
    try { await verifyDaytonaConnection(client, steps) } catch (error) { failure = error }

    const payload = jsonError(failure, steps)
    expect(payload.error).toMatchObject({
      code: 'SPARKPOD_AUTHENTICATION_FAILED', retryable: false, providerStatus: status,
      providerCode: 'invalid_token', diagnostic: 'Credential rejected for Bearer [REDACTED]',
    })
    expect(payload.error.steps).toEqual({
      sandboxCreated: 'failed', sandboxReady: 'not_started', commandExecuted: 'not_started',
      outputVerified: 'not_started', sandboxCleanedUp: 'not_started',
    })
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(JSON.stringify(payload)).not.toContain('Authorization:')
  })

  it.each([400, 422])('preserves bounded JSON diagnostics for provider status %i', async (status) => {
    const fetcher = vi.fn(async () => Response.json({
      code: 'invalid_sandbox_request',
      message: `  Sandbox   target is invalid ${'x'.repeat(600)}  `,
      ignoredSecret: 'must-not-be-returned',
    }, { status })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)
    let providerFailure: unknown
    try { await client.create() } catch (error) { providerFailure = error }

    const failure = normalizeDaytonaFailure(providerFailure, 'create')
    expect(failure).toMatchObject({
      code: 'SPARKPOD_DAYTONA_CONTRACT_FAILED', retryable: false,
      providerStatus: status, providerCode: 'invalid_sandbox_request',
    })
    expect((failure as unknown as { diagnostic: string }).diagnostic).toHaveLength(500)
    expect(JSON.stringify(jsonError(failure))).not.toContain('must-not-be-returned')
  })

  it.each([429, 500, 503])('marks transient HTTP %i creation failures retryable', async (status) => {
    const fetcher = vi.fn(async () => Response.json({ error: { type: 'provider_unavailable', message: 'Daytona is temporarily unavailable' } }, { status })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)
    let providerFailure: unknown
    try { await client.create() } catch (error) { providerFailure = error }

    expect(normalizeDaytonaFailure(providerFailure, 'create')).toMatchObject({
      code: 'SPARKPOD_SANDBOX_CREATION_FAILED', retryable: true, providerStatus: status,
      providerCode: 'provider_unavailable', diagnostic: 'Daytona is temporarily unavailable',
    })
  })

  it.each([400, 404, 422])('classifies HTTP %i create rejection as a non-retryable API contract failure', async (status) => {
    const fetcher = vi.fn(async () => Response.json({ code: 'invalid_contract', message: 'request rejected' }, { status })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)
    let providerFailure: unknown
    try { await client.create() } catch (error) { providerFailure = error }

    expect(normalizeDaytonaFailure(providerFailure, 'create')).toMatchObject({
      code: 'SPARKPOD_DAYTONA_CONTRACT_FAILED', retryable: false, providerStatus: status,
      providerCode: 'invalid_contract', diagnostic: 'request rejected',
    })
  })

  it('classifies a malformed successful provider response as a contract failure', async () => {
    const fetcher = vi.fn(async () => new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)
    let providerFailure: unknown
    try { await client.create() } catch (error) { providerFailure = error }

    expect(normalizeDaytonaFailure(providerFailure, 'create')).toMatchObject({
      code: 'SPARKPOD_DAYTONA_CONTRACT_FAILED', retryable: false,
    })
  })

  it('handles malformed non-JSON provider errors without dumping unsafe fields', async () => {
    const fetcher = vi.fn(async () => new Response('  upstream   gateway failed; api_key=top-secret-value  ', { status: 502 })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher)
    let providerFailure: unknown
    try { await client.create() } catch (error) { providerFailure = error }

    const payload = jsonError(normalizeDaytonaFailure(providerFailure, 'create'))
    expect(payload.error).toMatchObject({
      code: 'SPARKPOD_SANDBOX_CREATION_FAILED', retryable: true, providerStatus: 502,
      diagnostic: 'upstream gateway failed; api_key=[REDACTED]',
    })
    expect(JSON.stringify(payload)).not.toContain('top-secret-value')
  })

  it('classifies network failures distinctly and keeps them retryable', async () => {
    const client = new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch)
    let providerFailure: unknown
    try { await client.create() } catch (error) { providerFailure = error }

    expect(normalizeDaytonaFailure(providerFailure, 'create')).toMatchObject({
      code: 'SPARKPOD_DAYTONA_NETWORK_FAILED', status: 502, retryable: true,
    })
  })

  it('reports command execution failure and still cleans up the sandbox', async () => {
    let deleted = false
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/sandbox') && init?.method === 'POST') return Response.json({ id: 'sandbox-exec', state: 'started', toolboxProxyUrl: 'https://proxy.app.daytona.io/toolbox' })
      if (url.endsWith('/process/execute')) return Response.json({ message: 'toolbox unavailable', code: 'toolbox_unavailable' }, { status: 503 })
      if (url.endsWith('/sandbox/sandbox-exec') && init?.method === 'DELETE') { deleted = true; return Response.json({ state: 'destroying' }) }
      if (url.endsWith('/sandbox/sandbox-exec') && deleted) return new Response('{}', { status: 404 })
      return new Response('{}', { status: 500 })
    }
    const steps = freshSteps()
    await expect(verifyDaytonaConnection(new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher as typeof fetch), steps))
      .rejects.toMatchObject({ code: 'SPARKPOD_COMMAND_EXECUTION_FAILED', providerStatus: 503, retryable: true })
    expect(steps).toEqual({
      sandboxCreated: 'completed', sandboxReady: 'completed', commandExecuted: 'failed',
      outputVerified: 'not_started', sandboxCleanedUp: 'completed',
    })
  })

  it('reports cleanup failure while preserving completed earlier lifecycle steps', async () => {
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/sandbox') && init?.method === 'POST') return Response.json({ id: 'sandbox-cleanup', state: 'started', toolboxProxyUrl: 'https://proxy.app.daytona.io/toolbox' })
      if (url.endsWith('/process/execute')) return Response.json({ exitCode: 0, result: 'SparkPod OK\n' })
      if (url.endsWith('/sandbox/sandbox-cleanup') && init?.method === 'DELETE') return Response.json({ message: 'sandbox delete denied', code: 'delete_denied' }, { status: 422 })
      return new Response('{}', { status: 404 })
    }
    const steps = freshSteps()
    let failure: unknown
    try {
      await verifyDaytonaConnection(new DaytonaClient('server-only-secret-value', 'https://app.daytona.io/api', 'us', fetcher as typeof fetch), steps)
    } catch (error) { failure = error }

    expect(failure).toMatchObject({
      code: 'SPARKPOD_CLEANUP_FAILED', retryable: false, providerStatus: 422,
      providerCode: 'delete_denied', diagnostic: 'sandbox delete denied',
    })
    expect(steps).toEqual({
      sandboxCreated: 'completed', sandboxReady: 'completed', commandExecuted: 'completed',
      outputVerified: 'completed', sandboxCleanedUp: 'failed',
    })
  })

  it.each([
    ['create', 'SPARKPOD_SANDBOX_CREATION_FAILED', true],
    ['readiness', 'SPARKPOD_SANDBOX_READINESS_FAILED', true],
    ['execute', 'SPARKPOD_COMMAND_EXECUTION_FAILED', true],
    ['verify', 'SPARKPOD_OUTPUT_VERIFICATION_FAILED', false],
    ['cleanup', 'SPARKPOD_CLEANUP_FAILED', true],
  ] as const)('classifies a %s failure as %s', (stage, code, retryable) => {
    const error = normalizeDaytonaFailure(new Error('provider-internal-detail'), stage)
    expect(error).toMatchObject({ code, status: 502, retryable })
    expect(error.message).not.toContain('provider-internal-detail')
  })
})
