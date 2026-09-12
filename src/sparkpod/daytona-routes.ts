import { Daytona } from '@daytona/sdk'
import { Hono, type Context } from 'hono'
import { assertSameOrigin, requireOwner } from '../auth/owner'
import { AppError } from '../domain/types'
import type { Env } from '../config/env'

const routes = new Hono<{ Bindings: Env }>()
type DaytonaContext = Context<{ Bindings: Env }>

const DEFAULT_API_URL = 'https://app.daytona.io/api'
const DEFAULT_TARGET = 'us' as const

async function requireSetupOwner(c: DaytonaContext): Promise<void> {
  await requireOwner(c.req.header('Cf-Access-Jwt-Assertion'), {
    teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
    audience: c.env.CF_ACCESS_AUD,
    ownerEmail: c.env.OWNER_EMAIL,
  })
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

function getDaytona(c: DaytonaContext): Daytona {
  const apiKey = c.env.DAYTONA_API_KEY?.trim()
  if (!apiKey) {
    throw new AppError('SPARKPOD_DAYTONA_NOT_CONFIGURED', 'Daytona is not configured. Add DAYTONA_API_KEY as a Cloudflare Production Secret, then deploy again.', 503)
  }
  if (apiKey.length < 20 || apiKey.length > 1024) {
    throw new AppError('SPARKPOD_DAYTONA_INVALID_SECRET', 'The configured Daytona API key is invalid.', 503)
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

  return new Daytona({ apiKey, apiUrl: parsedUrl.toString().replace(/\/$/, ''), target })
}

routes.get('/status', async (c) => {
  try {
    await requireSetupOwner(c)
    c.header('Cache-Control', 'no-store')
    return c.json({
      configured: Boolean(c.env.DAYTONA_API_KEY?.trim()),
      apiUrl: c.env.DAYTONA_API_URL?.trim() || DEFAULT_API_URL,
      target: c.env.DAYTONA_TARGET || DEFAULT_TARGET,
      secretSource: 'cloudflare-pages-secret',
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
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    const daytona = getDaytona(c)
    let sandbox: Awaited<ReturnType<typeof daytona.create>> | undefined
    try {
      sandbox = await daytona.create({
        language: 'typescript',
        name: 'threads-tools-sparkpod-test',
        autoDeleteInterval: 10,
        ttlMinutes: 10,
      })
      const response = await sandbox.process.executeCommand('printf "SparkPod OK\\n"')
      if (response.exitCode !== 0) {
        throw new AppError('SPARKPOD_DAYTONA_COMMAND_FAILED', `Daytona sandbox command failed with exit code ${response.exitCode}.`, 502, true)
      }
      if (wantsHtml(c)) return htmlResult('SparkPod test passed', `Daytona created sandbox ${sandbox.id}, executed the isolated command successfully, and the sandbox was deleted. Output: ${response.result.trim() || 'SparkPod OK'}.`, '/setup')
      return c.json({ status: 'ok', sandboxId: sandbox.id, sandboxState: sandbox.state, output: response.result, secretSource: 'cloudflare-pages-secret' })
    } finally {
      if (sandbox) await sandbox.delete(60, true).catch(() => undefined)
    }
  } catch (error) {
    const body = jsonError(error)
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
