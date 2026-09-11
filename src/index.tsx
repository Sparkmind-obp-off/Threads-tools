import { Hono, type Context, type Next } from 'hono'
import { getConfig, missingConfiguration, type Env } from './config/env'
import { AppError } from './domain/types'
import { MetaThreadsProvider } from './threads/adapter'
import { D1ConnectionStore, D1OAuthStateStore } from './storage/repositories'
import { OAuthService } from './services/oauth'
import { ThreadsReadService } from './services/read'
import { clearSession, createSession, hasSession } from './auth/session'
import { constantTimeEqual } from './auth/crypto'

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Frame-Options', 'DENY')
  c.header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://threads.com")
  await next()
})

function safeError(error: unknown): AppError {
  if (error instanceof AppError) return error
  console.error('Safe diagnostic:', { category: 'unexpected_error', name: error instanceof Error ? error.name : 'unknown' })
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred. Please try again.', 500, true)
}

function jsonError(c: Context, error: unknown) {
  const normalized = safeError(error)
  return c.json({ error: { code: normalized.code, message: normalized.message, retryable: normalized.retryable, reauthorizationRequired: normalized.code === 'AUTHORIZATION_EXPIRED' } }, normalized.status as 400)
}

async function requireOperator(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    const config = getConfig(c.env)
    if (!(await hasSession(c, config.sessionSecret))) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Operator sign-in is required.' } }, 401)
    await next()
  } catch (error) { return jsonError(c, error) }
}

function provider(env: Env): MetaThreadsProvider { return new MetaThreadsProvider(getConfig(env)) }
function connectionStore(env: Env): D1ConnectionStore { return new D1ConnectionStore(env.DB, getConfig(env).sessionSecret) }
function oauthService(env: Env): OAuthService {
  return new OAuthService(provider(env), new D1OAuthStateStore(env.DB), connectionStore(env))
}
function readService(env: Env): ThreadsReadService { return new ThreadsReadService(provider(env), connectionStore(env)) }
function cursor(c: Context): string | undefined { return c.req.query('after') || undefined }
function limit(c: Context): number | undefined {
  const value = c.req.query('limit')
  return value ? Number(value) : undefined
}

app.get('/api/configuration', (c) => {
  const missing = missingConfiguration(c.env)
  return c.json({ status: missing.length ? 'not_configured' : 'supported', missing })
})

app.get('/api/session', async (c) => {
  try {
    if (missingConfiguration(c.env).length) return c.json({ authenticated: false })
    return c.json({ authenticated: await hasSession(c, getConfig(c.env).sessionSecret) })
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
app.use('/api/read/*', requireOperator)
app.use('/auth/threads/*', requireOperator)

app.get('/api/connection/status', async (c) => {
  try { return c.json(await connectionStore(c.env).getSafe()) }
  catch (error) { return jsonError(c, error) }
})

app.post('/api/connection/disconnect', async (c) => {
  try { await connectionStore(c.env).disconnect(); return c.json({ status: 'disconnected' }) }
  catch (error) { return jsonError(c, error) }
})

app.get('/api/read/account', async (c) => {
  try { return c.json({ status: 'supported', data: await readService(c.env).account() }) }
  catch (error) { return jsonError(c, error) }
})
app.get('/api/read/posts', async (c) => {
  try { return c.json(await readService(c.env).posts(cursor(c), limit(c))) }
  catch (error) { return jsonError(c, error) }
})
app.get('/api/read/posts/:id/replies', async (c) => {
  try { return c.json(await readService(c.env).replies(c.req.param('id'), cursor(c), limit(c))) }
  catch (error) { return jsonError(c, error) }
})
app.get('/api/read/posts/:id/insights', async (c) => {
  try { return c.json(await readService(c.env).postInsights(c.req.param('id'))) }
  catch (error) { return jsonError(c, error) }
})
app.get('/api/read/insights/account', async (c) => {
  try { return c.json(await readService(c.env).accountInsights()) }
  catch (error) { return jsonError(c, error) }
})

app.get('/auth/threads/start', async (c) => {
  try { return c.redirect((await oauthService(c.env).start()).authorizationUrl, 302) }
  catch (error) {
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

type PageName = 'dashboard' | 'posts' | 'engagement' | 'insights' | 'settings'
const titles: Record<PageName, string> = { dashboard: 'Dashboard', posts: 'Posts', engagement: 'Engagement', insights: 'Insights', settings: 'Connection & Settings' }

function navLink(active: PageName, name: PageName, href: string, label: string): string {
  return `<a class="${active === name ? 'active' : ''}" href="${href}">${label}</a>`
}

function page(active: PageName) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titles[active]} · Threads Tools</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/style.css"></head>
<body data-page="${active}"><a class="skip-link" href="#main-content">Skip to content</a>
<div class="app-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">T</span><span>Threads Tools</span></a>
<nav aria-label="Primary navigation">${navLink(active, 'dashboard', '/', 'Dashboard')}${navLink(active, 'posts', '/posts', 'Posts')}<span class="nav-disabled">Compose <small>Phase 3</small></span>${navLink(active, 'engagement', '/engagement', 'Engagement')}${navLink(active, 'insights', '/insights', 'Insights')}${navLink(active, 'settings', '/settings', 'Connection / Settings')}</nav>
<p class="phase-label">Phase 2 · Trustworthy read layer</p></aside>
<main id="main-content"><header class="topbar"><div><p class="eyebrow">Operator console</p><h1>${titles[active]}</h1></div><button id="sign-out" class="button ghost hidden" type="button">Sign out</button></header>
<section id="configuration-alert" class="alert warning hidden" role="status"></section>
<section id="login-panel" class="panel auth-panel hidden" aria-labelledby="login-title"><p class="eyebrow">Protected workspace</p><h2 id="login-title">Operator sign in</h2><p>Enter the server-configured operator password to access real Threads data.</p><form id="login-form"><label class="sr-only" for="operator-username">Username</label><input class="sr-only" id="operator-username" name="username" type="text" autocomplete="username" value="operator" tabindex="-1"><label for="password">Operator password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="button primary" type="submit">Sign in</button><p id="login-error" class="form-error" role="alert"></p></form></section>
<section id="workspace" class="hidden">${content(active)}</section>
</main></div><script type="module" src="/static/app.js"></script></body></html>`
}

function content(active: PageName): string {
  if (active === 'settings') return `<div class="page-intro"><p>Connect one real Threads account through the server-side OAuth flow. Reconnect to grant Phase 2 read permissions.</p></div><section class="panel" aria-labelledby="connection-title"><div class="panel-heading"><div><p class="eyebrow">Threads account</p><h2 id="connection-title">Connection status</h2></div><span id="status-badge" class="badge neutral">Checking</span></div><div id="connection-loading" class="skeleton-lines"><span></span><span></span></div><div id="connection-content" class="hidden"></div></section><section class="panel security-note"><h2>Security boundary</h2><p>Authorization codes and tokens remain server-side. Tokens are encrypted in D1 and provider responses are normalized before reaching this browser.</p></section>`
  if (active === 'dashboard') return `<section id="dashboard-account" class="panel state-panel" aria-live="polite"><div class="skeleton-lines"><span></span><span></span></div></section><section class="summary-grid"><article id="dashboard-engagement" class="panel state-panel"><div class="skeleton-lines"><span></span><span></span></div></article><article id="dashboard-insights" class="panel state-panel"><div class="skeleton-lines"><span></span><span></span></div></article></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Latest activity</p><h2>Recent posts</h2></div><a href="/posts">View all</a></div><div id="dashboard-posts" class="post-list"><div class="skeleton-lines"><span></span><span></span></div></div></section>`
  if (active === 'posts') return `<div class="page-intro"><p>Posts created by the connected app-scoped account. No fabricated counters or provider JSON dumps.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Owned media</p><h2>Your Threads posts</h2></div><span id="posts-count" class="badge neutral">Loading</span></div><div id="posts-list" class="post-list"><div class="skeleton-lines"><span></span><span></span></div></div><button id="load-more-posts" class="button secondary hidden" type="button">Load more</button></section>`
  if (active === 'engagement') return `<div class="page-intro"><p>Read-only top-level replies for your posts, when <code>threads_read_replies</code> is granted.</p></div><div class="split-layout"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Choose a post</p><h2>Recent posts</h2></div></div><div id="engagement-posts" class="compact-list"><div class="skeleton-lines"><span></span><span></span></div></div></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Conversation</p><h2>Top-level replies</h2></div><span id="replies-status" class="badge neutral">Waiting</span></div><div id="replies-list" class="reply-list"><div class="empty-state"><h3>Select a post</h3><p>Choose a recent post to load its supported replies.</p></div></div><button id="load-more-replies" class="button secondary hidden" type="button">Load more replies</button></section></div>`
  return `<div class="page-intro"><p>Metrics currently exposed by the Threads Insights API. Each unavailable capability is handled independently.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Account</p><h2>Account insights</h2></div><span id="account-insights-status" class="badge neutral">Loading</span></div><div id="account-insights" class="metric-grid"><div class="skeleton-lines"><span></span><span></span></div></div></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Content</p><h2>Post insights</h2></div></div><div id="insight-posts" class="insight-list"><div class="skeleton-lines"><span></span><span></span></div></div></section>`
}

app.get('/', (c) => c.html(page('dashboard')))
app.get('/posts', (c) => c.html(page('posts')))
app.get('/engagement', (c) => c.html(page('engagement')))
app.get('/insights', (c) => c.html(page('insights')))
app.get('/settings', (c) => c.html(page('settings')))

app.onError((error, c) => jsonError(c, error))
app.notFound((c) => c.html('<h1>Not found</h1><p><a href="/">Return to Threads Tools</a></p>', 404))

export default app
