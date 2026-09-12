import { Hono, type Context } from 'hono'
import { assertSameOrigin, requireOwner } from '../auth/owner'
import { AppError } from '../domain/types'
import type { Env } from '../config/env'

const routes = new Hono<{ Bindings: Env }>()
type DaytonaContext = Context<{ Bindings: Env }>
type TestStage = 'create' | 'execute' | 'cleanup'
type TestStepStatus = 'completed' | 'failed' | 'not_started'

interface TestSteps {
  sandboxCreated: TestStepStatus
  commandExecuted: TestStepStatus
  sandboxCleanedUp: TestStepStatus
}

interface DaytonaSandbox {
  id: string
  state?: string
  errorReason?: string
  toolboxProxyUrl?: string
}

interface DaytonaCommandResult {
  exitCode?: number
  code?: number
  result?: string
}

const DEFAULT_API_URL = 'https://app.daytona.io/api'
const DEFAULT_TARGET = 'us' as const

class DaytonaHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'DaytonaHttpError'
  }
}

export class DaytonaClient {
  private readonly headers: Record<string, string>

  constructor(
    private readonly apiKey: string,
    private readonly apiUrl: string,
    private readonly target: 'us' | 'eu',
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Daytona-Source': 'sparkpod-cloudflare',
    }
  }

  private async send<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(url, { ...init, headers: { ...this.headers, ...(init.headers || {}) } })
    if (!response.ok) throw new DaytonaHttpError(response.status, `Daytona request failed with status ${response.status}.`)
    if (response.status === 204) return undefined as T
    return response.json<T>()
  }

  private async sandbox(id: string): Promise<DaytonaSandbox> {
    return this.send(`${this.apiUrl}/sandbox/${encodeURIComponent(id)}`, { method: 'GET' })
  }

  async create(): Promise<DaytonaSandbox> {
    let sandbox = await this.send<DaytonaSandbox>(`${this.apiUrl}/sandbox`, {
      method: 'POST',
      body: JSON.stringify({
        name: `threads-tools-sparkpod-${crypto.randomUUID().slice(0, 8)}`,
        labels: { 'code-toolbox-language': 'typescript' },
        target: this.target,
        autoDeleteInterval: 10,
      }),
    })
    const deadline = Date.now() + 45_000
    while (sandbox.state !== 'started') {
      if (sandbox.state === 'error' || sandbox.state === 'build_failed') {
        throw new Error('Sandbox entered a failed state.')
      }
      if (Date.now() >= deadline) throw new Error('Sandbox did not start before timeout.')
      await new Promise((resolve) => setTimeout(resolve, 750))
      sandbox = await this.sandbox(sandbox.id)
    }
    return sandbox
  }

  async execute(sandbox: DaytonaSandbox): Promise<DaytonaCommandResult> {
    let toolboxProxyUrl = sandbox.toolboxProxyUrl
    if (!toolboxProxyUrl) {
      const response = await this.send<{ url: string }>(`${this.apiUrl}/sandbox/${encodeURIComponent(sandbox.id)}/toolbox-proxy-url`, { method: 'GET' })
      toolboxProxyUrl = response.url
    }
    const base = toolboxProxyUrl.replace(/\/$/, '')
    return this.send<DaytonaCommandResult>(`${base}/${encodeURIComponent(sandbox.id)}/process/execute`, {
      method: 'POST',
      body: JSON.stringify({ command: 'printf "SparkPod OK\\n"', timeout: 10 }),
    })
  }

  async delete(sandbox: DaytonaSandbox): Promise<void> {
    await this.send<unknown>(`${this.apiUrl}/sandbox/${encodeURIComponent(sandbox.id)}`, { method: 'DELETE' })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      try {
        const current = await this.sandbox(sandbox.id)
        if (current.state === 'destroyed') return
      } catch (error) {
        if (error instanceof DaytonaHttpError && error.status === 404) return
        throw error
      }
    }
    throw new Error('Sandbox cleanup did not complete before timeout.')
  }
}

async function requireSetupOwner(c: DaytonaContext): Promise<void> {
  await requireOwner(c.req.header('Cf-Access-Jwt-Assertion'), {
    teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
    audience: c.env.CF_ACCESS_AUD,
    ownerEmail: c.env.OWNER_EMAIL,
  })
}

function jsonError(error: unknown, steps?: TestSteps) {
  if (error instanceof AppError) return { error: { code: error.code, message: error.message, retryable: error.retryable, steps } }
  return { error: { code: 'SPARKPOD_DAYTONA_ERROR', message: 'Daytona connection test failed unexpectedly.', retryable: true, steps } }
}

function wantsHtml(c: DaytonaContext): boolean {
  return c.req.header('Accept')?.includes('text/html') === true
}

function htmlResult(title: string, message: string, backHref = '/setup'): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Threads Tools</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:4rem auto;padding:0 1rem}a{display:inline-block;margin-top:1rem}</style></head><body><h1>${title}</h1><p>${message}</p><a href="${backHref}">← Back to Threads Tools</a></body></html>`, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } })
}

function getDaytona(c: DaytonaContext): DaytonaClient {
  const apiKey = c.env.DAYTONA_API_KEY?.trim()
  if (!apiKey) {
    throw new AppError('SPARKPOD_SECRET_MISSING', 'The Cloudflare Production Secret DAYTONA_API_KEY is missing.', 503)
  }
  if (apiKey.length < 20 || apiKey.length > 1024) {
    throw new AppError('SPARKPOD_AUTHENTICATION_FAILED', 'Daytona authentication failed. Verify the configured Cloudflare Production Secret.', 401)
  }

  const apiUrl = c.env.DAYTONA_API_URL?.trim() || DEFAULT_API_URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(apiUrl)
  } catch {
    throw new AppError('SPARKPOD_DAYTONA_INVALID_CONFIG', 'DAYTONA_API_URL must be a valid URL.', 503)
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new AppError('SPARKPOD_DAYTONA_INVALID_CONFIG', 'DAYTONA_API_URL must use HTTPS.', 503)
  }

  const target = c.env.DAYTONA_TARGET || DEFAULT_TARGET
  if (target !== 'us' && target !== 'eu') {
    throw new AppError('SPARKPOD_DAYTONA_INVALID_CONFIG', 'DAYTONA_TARGET must be us or eu.', 503)
  }

  return new DaytonaClient(apiKey, parsedUrl.toString().replace(/\/$/, ''), target)
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  const status = value.status ?? value.statusCode ?? value.response?.status
  return typeof status === 'number' ? status : undefined
}

export function normalizeDaytonaFailure(error: unknown, stage: TestStage): AppError {
  if (error instanceof AppError) return error
  const status = providerStatus(error)
  const message = error instanceof Error ? error.message : ''
  const authenticationFailure = status === 401 || status === 403 || /auth|api.?key|credential|forbidden|unauthor/i.test(message)

  if (stage === 'create' && authenticationFailure) {
    return new AppError('SPARKPOD_AUTHENTICATION_FAILED', 'Daytona authentication failed. Verify the configured Cloudflare Production Secret.', 401)
  }
  if (stage === 'create') {
    return new AppError('SPARKPOD_SANDBOX_CREATION_FAILED', 'Daytona could not create the test sandbox.', 502, true)
  }
  if (stage === 'execute') {
    return new AppError('SPARKPOD_COMMAND_EXECUTION_FAILED', 'The command could not be executed successfully in the Daytona sandbox.', 502, true)
  }
  return new AppError('SPARKPOD_CLEANUP_FAILED', 'The test completed, but the Daytona sandbox could not be deleted. Auto-delete remains enabled.', 502, true)
}

routes.get('/status', async (c) => {
  try {
    await requireSetupOwner(c)
    c.header('Cache-Control', 'no-store')
    return c.json({
      configured: Boolean(c.env.DAYTONA_API_KEY?.trim()),
      provider: 'Daytona',
      credentialSource: 'Cloudflare Production Secret',
      secretName: 'DAYTONA_API_KEY',
    })
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 500)
  }
})

/**
 * Legacy endpoint intentionally retained as a safe migration guard.
 * Daytona credentials must never be accepted from the browser or stored in D1.
 */
routes.post('/credentials', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    throw new AppError('SPARKPOD_DAYTONA_SECRET_MANAGED_EXTERNALLY', 'Daytona credentials are managed as the Cloudflare Production Secret DAYTONA_API_KEY. This route does not accept or store API keys.', 409)
  } catch (error) {
    const body = jsonError(error)
    if (wantsHtml(c)) return htmlResult('Daytona secret is managed by Cloudflare', body.error.message, '/setup')
    return c.json(body, error instanceof AppError ? error.status as any : 409)
  }
})

routes.post('/test', async (c) => {
  const steps: TestSteps = { sandboxCreated: 'not_started', commandExecuted: 'not_started', sandboxCleanedUp: 'not_started' }
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    const daytona = getDaytona(c)
    let sandbox: DaytonaSandbox | undefined
    let operationError: AppError | undefined
    let output = ''

    try {
      try {
        sandbox = await daytona.create()
        steps.sandboxCreated = 'completed'
      } catch (error) {
        steps.sandboxCreated = 'failed'
        operationError = normalizeDaytonaFailure(error, 'create')
      }

      if (sandbox && !operationError) {
        try {
          const response = await daytona.execute(sandbox)
          const exitCode = response.exitCode ?? response.code
          if (exitCode !== 0 || response.result?.trim() !== 'SparkPod OK') throw new Error('Unexpected command result')
          output = response.result.trim()
          steps.commandExecuted = 'completed'
        } catch (error) {
          steps.commandExecuted = 'failed'
          operationError = normalizeDaytonaFailure(error, 'execute')
        }
      }
    } finally {
      if (sandbox) {
        try {
          await daytona.delete(sandbox)
          steps.sandboxCleanedUp = 'completed'
        } catch (error) {
          steps.sandboxCleanedUp = 'failed'
          operationError = normalizeDaytonaFailure(error, 'cleanup')
        }
      }
    }

    if (operationError) throw operationError
    return c.json({ status: 'connected', provider: 'Daytona', message: 'Daytona connected', output, steps })
  } catch (error) {
    const body = jsonError(error, steps)
    return c.json(body, error instanceof AppError ? error.status as any : 502)
  }
})

/**
 * Secret removal is deliberately not exposed from the application.
 * Remove DAYTONA_API_KEY from Cloudflare Pages Variables & Secrets if needed.
 */
routes.post('/disconnect', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    const message = 'Daytona credentials are managed in Cloudflare Pages Variables & Secrets. Remove DAYTONA_API_KEY there to disconnect.'
    if (wantsHtml(c)) return htmlResult('Manage Daytona secret in Cloudflare', message, '/setup')
    return c.json({ status: 'managed_externally', secretName: 'DAYTONA_API_KEY', message })
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 500)
  }
})

export default routes
