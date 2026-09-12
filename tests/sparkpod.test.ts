import { describe, expect, it, vi } from 'vitest'
import { DaytonaClient, normalizeDaytonaFailure, verifyDaytonaConnection, type TestSteps } from '../src/sparkpod/daytona-routes'

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
      commandExecuted: true,
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

  it('bounds individual Daytona requests with an abort signal', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as unknown as typeof fetch
    const client = new DaytonaClient('server-only-secret', 'https://app.daytona.io/api', 'us', fetcher, 5)

    await expect(client.create()).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('classifies provider authentication failures without returning provider details', () => {
    const error = normalizeDaytonaFailure(Object.assign(new Error('API key unauthorized: sensitive-provider-detail'), { status: 401 }), 'create')
    expect(error).toMatchObject({ code: 'SPARKPOD_AUTHENTICATION_FAILED', status: 401, retryable: false })
    expect(error.message).not.toContain('sensitive-provider-detail')
  })

  it.each([
    ['create', 'SPARKPOD_SANDBOX_CREATION_FAILED'],
    ['readiness', 'SPARKPOD_SANDBOX_READINESS_FAILED'],
    ['execute', 'SPARKPOD_COMMAND_EXECUTION_FAILED'],
    ['verify', 'SPARKPOD_OUTPUT_VERIFICATION_FAILED'],
    ['cleanup', 'SPARKPOD_CLEANUP_FAILED'],
  ] as const)('classifies a %s failure as %s', (stage, code) => {
    const error = normalizeDaytonaFailure(new Error('provider-internal-detail'), stage)
    expect(error).toMatchObject({ code, status: 502, retryable: true })
    expect(error.message).not.toContain('provider-internal-detail')
  })
})
