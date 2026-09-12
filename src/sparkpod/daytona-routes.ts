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

export interface DaytonaPreflightResult {
  reachable: boolean
  classification: 'reachable' | 'authentication' | 'provider' | 'network' | 'timeout' | 'configuration'
  providerStatus?: number
  providerCode?: string
  diagnostic?: string
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
const PROVIDER_DIAGNOSTIC_LIMIT = 500

class DaytonaHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly providerMessage?: string,
    public readonly providerCode?: string,
  ) {
    super(`Daytona request failed with status ${status}.`)
    this.name = 'DaytonaHttpError'
  }
}

class DaytonaFailure extends AppError {
  constructor(
    code: string,
    message: string,
    status: number,
    retryable: boolean,
    public readonly providerStatus?: number,
    public readonly diagnostic?: string,
    public readonly providerCode?: string,
  ) {
    super(code, message, status, retryable)
    this.name = 'DaytonaFailure'
  }
}

function safeDiagnostic(value: unknown, apiKey = ''): string | undefined {
  if (typeof value !== 'string') return undefined
  let text = value
    .replace(/\s+/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|cookie)\s*[=:]\s*)[^\s,;}\"]+/gi, '$1[REDACTED]')
    .trim()
  if (apiKey) text = text.split(apiKey).join('[REDACTED]')
  if (!text) return undefined
  return text.slice(0, PROVIDER_DIAGNOSTIC_LIMIT)
}

function providerErrorDetails(raw: string, apiKey: string): { message?: string; code?: string } {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { message: safeDiagnostic(raw, apiKey) } }
  if (!parsed || typeof parsed !== 'object') return { message: safeDiagnostic(raw, apiKey) }

  const body = parsed as Record<string, unknown>
  const nested = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : undefined
  const message = [body.message, body.detail, body.title, typeof body.error === 'string' ? body.error : undefined,
    nested?.message, nested?.detail, nested?.title].find((value) => typeof value === 'string')
  const code = [body.code, body.type, body.errorCode, nested?.code, nested?.type].find((value) => typeof value === 'string')
  return { message: safeDiagnostic(message, apiKey), code: safeDiagnostic(code, apiKey)?.slice(0, 100) }
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
      if (response.status === 204) return undefined as T
      const raw = await response.text()
      if (!response.ok) {
        const details = providerErrorDetails(raw, this.apiKey)
        throw new DaytonaHttpError(response.status, details.message, details.code)
      }
      return JSON.parse(raw) as T
    } finally {
      clearTimeout(timeout)
    }
  }

  async preflight(): Promise<DaytonaPreflightResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const response = await this.fetcher(this.apiUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { ...this.headers },
      })
      const raw = await response.text()
      const details = providerErrorDetails(raw, this.apiKey)
      const status = response.status
      if (status === 401 || status === 403) {
        return { reachable: true, classification: 'authentication', providerStatus: status, providerCode: details.code, diagnostic: details.message }
      }
      if (status === 429 || status >= 500) {
        return { reachable: true, classification: 'provider', providerStatus: status, providerCode: details.code, diagnostic: details.message }
      }
      return { reachable: true, classification: 'reachable', providerStatus: status, providerCode: details.code, diagnostic: details.message }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { reachable: false, classification: 'timeout' }
      }
      return { reachable: false, classification: 'network', diagnostic: safeDiagnostic(error instanceof Error ? error.message : String(error), this.apiKey) }
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

export function jsonError(error: unknown, steps?: TestSteps) {
  if (error instanceof AppError) {
    const diagnostic = error instanceof DaytonaFailure ? {
      providerStatus: error.providerStatus,
      diagnostic: error.diagnostic,
      providerCode: error.providerCode,
    } : {}
    return { error: { code: error.code, message: error.message, retryable: error.retryable, steps, ...diagnostic } }
  }
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
  const providerMessage = error instanceof DaytonaHttpError ? error.providerMessage : undefined
  const providerCode = error instanceof DaytonaHttpError ? error.providerCode : undefined
  const internalMessage = error instanceof Error ? error.message : ''
  const classificationText = `${providerMessage || ''} ${providerCode || ''} ${internalMessage}`
  const authenticationFailure = status === 401 || status === 403
    || /(?:invalid|expired|missing|rejected|revoked)\s+(?:auth(?:entication|orization)?|api.?key|credential|token)|(?:forbidden|unauthori[sz]ed)/i.test(classificationText)
  const timedOut = error instanceof DOMException && error.name === 'AbortError'
    || /timeout|timed out|did not .* before timeout/i.test(internalMessage)
  const networkFailure = !status && (error instanceof TypeError || /network|fetch|connection|socket|dns/i.test(internalMessage))
  const retryable = status === 429 || (typeof status === 'number' && status >= 500) || status === undefined

  if (authenticationFailure) {
    return new DaytonaFailure(
      'SPARKPOD_AUTHENTICATION_FAILED',
      'Daytona rejected the configured credential. Verify DAYTONA_API_KEY in Cloudflare Production Secrets before retrying.',
      401,
      false,
      status,
      providerMessage,
      providerCode,
    )
  }
  if (timedOut) {
    return new DaytonaFailure(
      'SPARKPOD_DAYTONA_TIMEOUT',
      `The Daytona connection test timed out during ${stage}.`,
      504,
      true,
      status,
      providerMessage,
      providerCode,
    )
  }
  if (networkFailure) {
    return new DaytonaFailure(
      'SPARKPOD_DAYTONA_NETWORK_FAILED',
      `The Daytona network request failed during ${stage}.`,
      502,
      true,
      status,
      providerMessage,
      providerCode,
    )
  }

  const details = { providerStatus: status, diagnostic: providerMessage, providerCode }
  if (stage === 'create') {
    return new DaytonaFailure('SPARKPOD_SANDBOX_CREATION_FAILED', 'Daytona could not create the test sandbox.', 502, retryable, details.providerStatus, details.diagnostic, details.providerCode)
  }
  if (stage === 'readiness') {
    return new DaytonaFailure('SPARKPOD_SANDBOX_READINESS_FAILED', 'The Daytona sandbox was created but did not become ready.', 502, retryable, details.providerStatus, details.diagnostic, details.providerCode)
  }
  if (stage === 'execute') {
    return new DaytonaFailure('SPARKPOD_COMMAND_EXECUTION_FAILED', 'The command could not be executed successfully in the Daytona sandbox.', 502, retryable, details.providerStatus, details.diagnostic, details.providerCode)
  }
  if (stage === 'verify') {
    return new DaytonaFailure('SPARKPOD_OUTPUT_VERIFICATION_FAILED', 'The Daytona command completed but its deterministic output could not be verified.', 502, false, details.providerStatus, details.diagnostic, details.providerCode)
  }
  return new DaytonaFailure('SPARKPOD_CLEANUP_FAILED', 'The test completed, but the Daytona sandbox could not be deleted. Auto-delete remains enabled.', 502, retryable, details.providerStatus, details.diagnostic, details.providerCode)
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

routes.post('/preflight', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    c.header('Cache-Control', 'no-store')
    const result = await getDaytona(c).preflight()
    return c.json(result)
  } catch (error) {
    c.header('Cache-Control', 'no-store')
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 502)
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
