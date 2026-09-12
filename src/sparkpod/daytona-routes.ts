import { Hono, type Context } from 'hono'
import { assertSameOrigin, requireOwner } from '../auth/owner'
import { AppError } from '../domain/types'
import type { Env } from '../config/env'
import { DaytonaCredentialStore } from './daytona'

const routes = new Hono<{ Bindings: Env }>()
type DaytonaContext = Context<{ Bindings: Env }>

async function requireSetupOwner(c: DaytonaContext): Promise<void> {
  await requireOwner(c.req.header('Cf-Access-Jwt-Assertion'), {
    teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
    audience: c.env.CF_ACCESS_AUD,
    ownerEmail: c.env.OWNER_EMAIL,
  })
}

function store(env: Env): DaytonaCredentialStore {
  return new DaytonaCredentialStore(env.DB, env.SESSION_SECRET?.trim() || '')
}

function jsonError(error: unknown) {
  if (error instanceof AppError) return { error: { code: error.code, message: error.message, retryable: error.retryable } }
  const message = error instanceof Error ? error.message : 'Unexpected Daytona error.'
  return { error: { code: 'SPARKPOD_DAYTONA_ERROR', message, retryable: false } }
}

routes.get('/status', async (c) => {
  try {
    await requireSetupOwner(c)
    c.header('Cache-Control', 'no-store')
    return c.json(await store(c.env).status())
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 500)
  }
})

routes.post('/credentials', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    const contentLength = Number(c.req.header('content-length') || 0)
    if (contentLength > 4096) throw new AppError('VALIDATION_FAILED', 'Daytona credential request is too large.', 413)
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}))
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
    const apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl : undefined
    const target = body.target === 'eu' ? 'eu' : body.target === 'us' ? 'us' : undefined
    await store(c.env).save(apiKey, apiUrl, target)
    return c.json({ status: 'connected', ...(await store(c.env).status()) })
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 400)
  }
})

routes.post('/test', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    const daytona = await store(c.env).client()
    let sandbox: Awaited<ReturnType<typeof daytona.create>> | undefined
    try {
      sandbox = await daytona.create({
        language: 'typescript',
        name: 'threads-tools-sparkpod-test',
        autoDeleteInterval: 10,
        ttlMinutes: 10,
      })
      const response = await sandbox.process.executeCommand('printf "SparkPod OK\\n"')
      return c.json({ status: 'ok', sandboxId: sandbox.id, sandboxState: sandbox.state, output: response.result })
    } finally {
      if (sandbox) await sandbox.delete(60, true).catch(() => undefined)
      const dispose = daytona[Symbol.asyncDispose]
      if (dispose) await dispose.call(daytona).catch(() => undefined)
    }
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 502)
  }
})

routes.post('/disconnect', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    await store(c.env).remove()
    return c.json({ status: 'disconnected' })
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 500)
  }
})

export default routes
