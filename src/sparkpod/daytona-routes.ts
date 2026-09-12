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

function wantsHtml(c: DaytonaContext): boolean {
  return c.req.header('Accept')?.includes('text/html') === true
}

function htmlResult(title: string, message: string, backHref = '/setup'): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Threads Tools</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:4rem auto;padding:0 1rem}a{display:inline-block;margin-top:1rem}</style></head><body><h1>${title}</h1><p>${message}</p><a href="${backHref}">← Back to Threads Tools</a></body></html>`, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } })
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
    const contentType = c.req.header('Content-Type') || ''
    let apiKey = ''
    let apiUrl: string | undefined
    let target: 'us' | 'eu' | undefined
    if (contentType.includes('application/json')) {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({}))
      apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
      apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl : undefined
      target = body.target === 'eu' ? 'eu' : body.target === 'us' ? 'us' : undefined
    } else {
      const body = await c.req.parseBody()
      apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
      apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl : undefined
      target = body.target === 'eu' ? 'eu' : body.target === 'us' ? 'us' : undefined
    }
    await store(c.env).save(apiKey, apiUrl, target)
    if (wantsHtml(c)) return htmlResult('Daytona connected', 'The API key was encrypted and stored server-side. No credential value was returned to the browser.', '/setup')
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
      if (wantsHtml(c)) return htmlResult('SparkPod test passed', `Daytona created sandbox ${sandbox.id}, executed the isolated command successfully, and the sandbox was deleted. Output: ${response.result.trim() || 'SparkPod OK'}.`, '/setup')
      return c.json({ status: 'ok', sandboxId: sandbox.id, sandboxState: sandbox.state, output: response.result })
    } finally {
      if (sandbox) await sandbox.delete(60, true).catch(() => undefined)
      await daytona[Symbol.asyncDispose].catch(() => undefined)
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
    if (wantsHtml(c)) return htmlResult('Daytona disconnected', 'The encrypted Daytona credential has been removed.', '/setup')
    return c.json({ status: 'disconnected' })
  } catch (error) {
    const body = jsonError(error)
    return c.json(body, error instanceof AppError ? error.status as any : 500)
  }
})

export default routes
