import { Hono, type Context } from 'hono'
import { assertSameOrigin, requireOwner } from '../auth/owner'
import { AppError } from '../domain/types'
import type { Env } from '../config/env'

const routes = new Hono<{ Bindings: Env }>()
type DaytonaContext = Context<{ Bindings: Env }>
type TestStage = 'create' | 'readiness' | 'execute' | 'verify' | 'cleanup'
type TestStepStatus = 'completed' | 'failed' | 'not_started'

export interface TestSteps {
  sandboxCreated: TestStepStatus
  sandboxReady: TestStepStatus
  commandExecuted: TestStepStatus
  outputVerified: TestStepStatus
  sandboxCleanedUp: TestStepStatus
}

export interface DaytonaConnectionResult {
  status: 'connected'
  provider: 'daytona'
  sandboxCreated: true
  commandExecuted: true
  sandboxCleanedUp: true
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
const REQUEST_TIMEOUT_MS = 20_000

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
    private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Daytona-Source': 'sparkpod-cloudflare',
    }
  }

  private async send<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
        headers: { ...this.headers, ...(init.headers || {}) },
      })
      if (!response.ok) throw new DaytonaHttpError(response.status, `Daytona request failed with status ${response.status}.`)
      if (response.status === 204) return undefined as T
      return response.json<T>()
    } finally {
      clearTimeout(timeout)
    }
  }

  private async sandbox(id: string): Promise<DaytonaSandbox> {
    return this.send(`${this.apiUrl}/sandbox/${encodeURIComponent(id)}`, { method: 'GET' })
  }

  async create(): Promise<DaytonaSandbox> {
    const sandbox = await this.send<DaytonaSandbox>(`${this.apiUrl}/sandbox`, {
      method: 'POST',
      body: JSON.stringify({
        name: `threads-tools-sparkpod-${crypto.randomUUID().slice(0, 8)}`,
        labels: { 'code-toolbox-language': 'typescript' },
        target: this.target,
        autoDeleteInterval: 10,
        ttlMinutes: 10,
      }),
    })
    if (!sandbox?.id) throw new Error('Daytona did not return a sandbox identifier.')
    return sandbox
  }

  async waitUntilStarted(initial: DaytonaSandbox): Promise<DaytonaSandbox> {
    let sandbox = initial
    const deadline = Date.now() + 45_000
    while (sandbox.state !== 'started') {
      if (sandbox.state === 'error' || sandbox.state === 'build_failed' || sandbox.state === 'destroyed') {
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
    const proxyUrl = new URL(toolboxProxyUrl)
    if (proxyUrl.protocol !== 'https:' || proxyUrl.username || proxyUrl.password) {
      throw new Error('Daytona returned an invalid toolbox endpoint.')
    }
    const base = proxyUrl.toString().replace(/\/$/, '')
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
  if (stage === 'readiness') {
    return new AppError('SPARKPOD_SANDBOX_READINESS_FAILED', 'The Daytona sandbox was created but did not become ready.', 502, true)
  }
  if (stage === 'execute') {
    return new AppError('SPARKPOD_COMMAND_EXECUTION_FAILED', 'The command could not be executed successfully in the Daytona sandbox.', 502, true)
  }
  if (stage === 'verify') {
    return new AppError('SPARKPOD_OUTPUT_VERIFICATION_FAILED', 'The Daytona command completed but its deterministic output could not be verified.', 502, true)
  }
  return new AppError('SPARKPOD_CLEANUP_FAILED', 'The test completed, but the Daytona sandbox could not be deleted. Auto-delete remains enabled.', 502, true)
}

routes.get('/status', async (c) => {
  try {
    await requireSetupOwner(c)
    c.header('Cache-Control', 'no-store')
    const configured = Boolean(c.env.DAYTONA_API_KEY?.trim())
    return c.json({
      status: configured ? 'configured' : 'not_configured',
      configured,
      provider: 'daytona',
      credentialSource: 'Cloudflare Production Secret',
      secretName: 'DAYTONA_API_KEY',
    })
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 500)
  }
})

export async function verifyDaytonaConnection(daytona: DaytonaClient, steps: TestSteps): Promise<DaytonaConnectionResult> {
  let sandbox: DaytonaSandbox | undefined
  let operationError: AppError | undefined

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
        sandbox = await daytona.waitUntilStarted(sandbox)
        steps.sandboxReady = 'completed'
      } catch (error) {
        steps.sandboxReady = 'failed'
        operationError = normalizeDaytonaFailure(error, 'readiness')
      }
    }

    let response: DaytonaCommandResult | undefined
    if (sandbox && !operationError) {
      try {
        response = await daytona.execute(sandbox)
        steps.commandExecuted = 'completed'
      } catch (error) {
        steps.commandExecuted = 'failed'
        operationError = normalizeDaytonaFailure(error, 'execute')
      }
    }

    if (response && !operationError) {
      const exitCode = response.exitCode ?? response.code
      if (exitCode !== 0 || response.result?.trim() !== 'SparkPod OK') {
        steps.outputVerified = 'failed'
        operationError = normalizeDaytonaFailure(new Error('Unexpected command result'), 'verify')
      } else {
        steps.outputVerified = 'completed'
      }
    }
  } finally {
    if (sandbox) {
      try {
        await daytona.delete(sandbox)
        steps.sandboxCleanedUp = 'completed'
      } catch (error) {
        steps.sandboxCleanedUp = 'failed'
        operationError ??= normalizeDaytonaFailure(error, 'cleanup')
      }
    }
  }

  if (operationError) throw operationError
  return {
    status: 'connected',
    provider: 'daytona',
    sandboxCreated: true,
    commandExecuted: true,
    sandboxCleanedUp: true,
  }
}

routes.post('/test', async (c) => {
  const steps: TestSteps = {
    sandboxCreated: 'not_started',
    sandboxReady: 'not_started',
    commandExecuted: 'not_started',
    outputVerified: 'not_started',
    sandboxCleanedUp: 'not_started',
  }
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    c.header('Cache-Control', 'no-store')
    return c.json(await verifyDaytonaConnection(getDaytona(c), steps))
  } catch (error) {
    c.header('Cache-Control', 'no-store')
    const body = jsonError(error, steps)
    return c.json(body, error instanceof AppError ? error.status as any : 502)
  }
})

export default routes
