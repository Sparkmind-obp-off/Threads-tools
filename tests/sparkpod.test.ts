import { describe, expect, it } from 'vitest'
import { DaytonaClient, normalizeDaytonaFailure } from '../src/sparkpod/daytona-routes'

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
    const sandbox = await client.create()
    expect(await client.execute(sandbox)).toMatchObject({ exitCode: 0, result: 'SparkPod OK\n' })
    await client.delete(sandbox)

    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['POST', 'https://app.daytona.io/api/sandbox'],
      ['POST', 'https://proxy.app.daytona.io/toolbox/sandbox-1/process/execute'],
      ['DELETE', 'https://app.daytona.io/api/sandbox/sandbox-1'],
      ['GET', 'https://app.daytona.io/api/sandbox/sandbox-1'],
    ])
    expect(calls.every((call) => new Headers(call.init?.headers).get('Authorization') === 'Bearer server-only-secret')).toBe(true)
  })

  it('classifies provider authentication failures without returning provider details', () => {
    const error = normalizeDaytonaFailure(Object.assign(new Error('API key unauthorized: sensitive-provider-detail'), { status: 401 }), 'create')
    expect(error).toMatchObject({ code: 'SPARKPOD_AUTHENTICATION_FAILED', status: 401, retryable: false })
    expect(error.message).not.toContain('sensitive-provider-detail')
  })

  it.each([
    ['create', 'SPARKPOD_SANDBOX_CREATION_FAILED'],
    ['execute', 'SPARKPOD_COMMAND_EXECUTION_FAILED'],
    ['cleanup', 'SPARKPOD_CLEANUP_FAILED'],
  ] as const)('classifies a %s failure as %s', (stage, code) => {
    const error = normalizeDaytonaFailure(new Error('provider-internal-detail'), stage)
    expect(error).toMatchObject({ code, status: 502, retryable: true })
    expect(error.message).not.toContain('provider-internal-detail')
  })
})
