import { Hono, type Context, type Next } from 'hono'
import { getConfig, missingConfiguration, type Env } from './config/env'
import { AppError } from './domain/types'
import { MetaThreadsProvider } from './threads/adapter'
import { D1ConnectionStore, D1OAuthStateStore } from './storage/repositories'
import { OAuthService } from './services/oauth'
import { clearSession, createSession, hasSession } from './auth/session'
import { constantTimeEqual } from './auth/crypto'

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Frame-Options', 'DENY')
  c.header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://threads.com")
  await next()
})

function safeError(error: unknown): AppError {
  if (error instanceof AppError) return error
  console.error('Safe diagnostic:', { category: 'unexpected_error', name: error instanceof Error ? error.name : 'unknown' })
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred. Please try again.', 500, true)
}

function jsonError(c: Context, error: unknown) {
  const normalized = safeError(error)
  return c.json({ error: { code: normalized.code, message: normalized.message, retryable: normalized.retryable } }, normalized.status as 400)
}

async function requireOperator(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    const config = getConfig(c.env)
    if (!(await hasSession(c, config.sessionSecret))) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Operator sign-in is required.' } }, 401)
    await next()
  } catch (error) { return jsonError(c, error) }
}

function oauthService(env: Env): OAuthService {
  const config = getConfig(env)
  return new OAuthService(
    new MetaThreadsProvider(config),
    new D1OAuthStateStore(env.DB),
    new D1ConnectionStore(env.DB, config.sessionSecret),
  )
}

app.get('/api/configuration', (c) => {
  const missing = missingConfiguration(c.env)
  return c.json({ status: missing.length ? 'not_configured' : 'supported', missing })
})

app.get('/api/session', async (c) => {
  try {
    if (missingConfiguration(c.env).length) return c.json({ authenticated: false })
    const config = getConfig(c.env)
    return c.json({ authenticated: await hasSession(c, config.sessionSecret) })
  } catch { return c.json({ authenticated: false }) }
})

app.post('/api/session', async (c) => {
  try {
    const config = getConfig(c.env)
    const body: { password?: string } = await c.req.json<{ password?: string }>().catch(() => ({}))
    if (!body.password || !(await constantTimeEqual(body.password, config.operatorPassword))) {
      return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'The operator password is incorrect.' } }, 401)
    }
    await createSession(c, config.sessionSecret)
    return c.json({ authenticated: true })
  } catch (error) { return jsonError(c, error) }
})

app.delete('/api/session', (c) => { clearSession(c); return c.json({ authenticated: false }) })

app.use('/api/connection/*', requireOperator)
app.use('/auth/threads/*', requireOperator)

app.get('/api/connection/status', async (c) => {
  try {
    const config = getConfig(c.env)
    return c.json(await new D1ConnectionStore(c.env.DB, config.sessionSecret).getSafe())
  } catch (error) { return jsonError(c, error) }
})

app.post('/api/connection/disconnect', async (c) => {
  try {
    const config = getConfig(c.env)
    await new D1ConnectionStore(c.env.DB, config.sessionSecret).disconnect()
    return c.json({ status: 'disconnected' })
  } catch (error) { return jsonError(c, error) }
})

app.get('/auth/threads/start', async (c) => {
  try {
    const { authorizationUrl } = await oauthService(c.env).start()
    return c.redirect(authorizationUrl, 302)
  } catch (error) {
    const normalized = safeError(error)
    return c.redirect(`/settings?result=error&code=${encodeURIComponent(normalized.code)}`, 302)
  }
})

app.get('/auth/threads/callback', async (c) => {
  try {
    await oauthService(c.env).callback({
      state: c.req.query('state'), code: c.req.query('code'), error: c.req.query('error'),
      errorDescription: c.req.query('error_description'),
    })
    return c.redirect('/settings?result=connected', 303)
  } catch (error) {
    const normalized = safeError(error)
    return c.redirect(`/settings?result=error&code=${encodeURIComponent(normalized.code)}`, 303)
  }
})

function page(active: 'dashboard' | 'settings') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${active === 'settings' ? 'Connection' : 'Dashboard'} · Threads Tools</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/style.css"></head>
<body data-page="${active}"><a class="skip-link" href="#main-content">Skip to content</a>
<div class="app-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">T</span><span>Threads Tools</span></a>
<nav aria-label="Primary navigation"><a class="${active === 'dashboard' ? 'active' : ''}" href="/">Dashboard</a><span class="nav-disabled">Posts <small>Phase 2</small></span><span class="nav-disabled">Compose <small>Phase 3</small></span><span class="nav-disabled">Engagement <small>Phase 2</small></span><span class="nav-disabled">Insights <small>Phase 2</small></span><a class="${active === 'settings' ? 'active' : ''}" href="/settings">Connection / Settings</a></nav>
<p class="phase-label">Phase 1 · Connection foundation</p></aside>
<main id="main-content"><header class="topbar"><div><p class="eyebrow">Operator console</p><h1>${active === 'settings' ? 'Connection & Settings' : 'Dashboard'}</h1></div><button id="sign-out" class="button ghost hidden" type="button">Sign out</button></header>
<section id="configuration-alert" class="alert warning hidden" role="status"></section>
<section id="login-panel" class="panel auth-panel hidden" aria-labelledby="login-title"><p class="eyebrow">Protected workspace</p><h2 id="login-title">Operator sign in</h2><p>Enter the server-configured operator password to manage the Threads connection.</p><form id="login-form"><label class="sr-only" for="operator-username">Username</label><input class="sr-only" id="operator-username" name="username" type="text" autocomplete="username" value="operator" tabindex="-1"><label for="password">Operator password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="button primary" type="submit">Sign in</button><p id="login-error" class="form-error" role="alert"></p></form></section>
<section id="workspace" class="hidden">${active === 'settings' ? settingsContent() : dashboardContent()}</section>
</main></div><script type="module" src="/static/app.js"></script></body></html>`
}

function settingsContent() { return `<div class="page-intro"><p>Connect one real Threads account through a secure server-side OAuth flow.</p></div><section class="panel" aria-labelledby="connection-title"><div class="panel-heading"><div><p class="eyebrow">Threads account</p><h2 id="connection-title">Connection status</h2></div><span id="status-badge" class="badge neutral">Checking</span></div><div id="connection-loading" class="skeleton-lines" aria-label="Loading connection status"><span></span><span></span></div><div id="connection-content" class="hidden"></div></section><section class="panel security-note"><h2>Security boundary</h2><p>Authorization codes and tokens are handled only by the server. Access tokens are encrypted before storage and never included in browser responses.</p></section>` }
function dashboardContent() { return `<div class="hero panel"><p class="eyebrow">Phase 1</p><h2>Your connection foundation</h2><p>Threads Tools is ready to establish and verify a trustworthy account connection. Posts, publishing, engagement, and insights remain intentionally unavailable until later phases.</p><a class="button primary" href="/settings">Manage Threads connection</a></div><section class="capability-grid" aria-label="Roadmap capabilities"><article class="panel"><span class="badge supported">Available now</span><h3>Secure connection</h3><p>OAuth, normalized account identity, encrypted credential storage, and safe errors.</p></article><article class="panel muted"><span class="badge neutral">Later phase</span><h3>Content operations</h3><p>Real posts and publishing will be added only after the Phase 1 connection gate passes.</p></article></section>` }

app.get('/', (c) => c.html(page('dashboard')))
app.get('/settings', (c) => c.html(page('settings')))

app.onError((error, c) => jsonError(c, error))
app.notFound((c) => c.html('<h1>Not found</h1><p><a href="/">Return to Threads Tools</a></p>', 404))

export default app
