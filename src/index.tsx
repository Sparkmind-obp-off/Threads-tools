import { Hono, type Context, type Next } from 'hono'
import { getConfig, missingConfiguration, type Env } from './config/env'
import { AppError } from './domain/types'
import { MetaThreadsProvider } from './threads/adapter'
import { D1AuditStore, D1ConnectionStore, D1OAuthStateStore, D1PublishRequestStore } from './storage/repositories'
import { OAuthService } from './services/oauth'
import { ThreadsReadService } from './services/read'
import { ThreadsPublishService } from './services/publish'
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
function auditStore(env: Env): D1AuditStore { return new D1AuditStore(env.DB) }
function oauthService(env: Env): OAuthService {
  return new OAuthService(provider(env), new D1OAuthStateStore(env.DB), connectionStore(env), () => new Date(), auditStore(env))
}
function readService(env: Env): ThreadsReadService { return new ThreadsReadService(provider(env), connectionStore(env)) }
function publishService(env: Env): ThreadsPublishService {
  return new ThreadsPublishService(provider(env), connectionStore(env), new D1PublishRequestStore(env.DB), auditStore(env))
}
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
app.use('/api/publish/*', requireOperator)
app.use('/api/audit/*', requireOperator)
app.use('/auth/threads/*', requireOperator)

app.get('/api/connection/status', async (c) => {
  try { return c.json(await connectionStore(c.env).getSafe()) }
  catch (error) { return jsonError(c, error) }
})

app.post('/api/connection/disconnect', async (c) => {
  try {
    const connection = await connectionStore(c.env).getSafe()
    await connectionStore(c.env).disconnect()
    await auditStore(c.env).record('oauth_disconnected', 'success', connection.accountId).catch(() => undefined)
    return c.json({ status: 'disconnected' })
  } catch (error) { return jsonError(c, error) }
})

app.get('/api/read/account', async (c) => {
  try { return c.json({ status: 'supported', data: await readService(c.env).account() }) }
  catch (error) { return jsonError(c, error) }
})
app.get('/api/read/posts', async (c) => {
  try { return c.json(await readService(c.env).posts(cursor(c), limit(c))) }
  catch (error) { return jsonError(c, error) }
})
app.get('/api/read/posts/:id', async (c) => {
  try { return c.json({ status: 'supported', data: await readService(c.env).post(c.req.param('id')) }) }
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
app.get('/api/read/insights/account/compare', async (c) => {
  try { return c.json(await readService(c.env).accountInsightsComparison(Number(c.req.query('days') || 7))) }
  catch (error) { return jsonError(c, error) }
})
app.get('/api/audit/events', async (c) => {
  try { return c.json(await auditStore(c.env).list(cursor(c), limit(c))) }
  catch (error) { return jsonError(c, error) }
})

app.post('/api/publish/posts', async (c) => {
  try {
    const contentLength = Number(c.req.header('content-length') || 0)
    if (contentLength > 8192) throw new AppError('VALIDATION_FAILED', 'Publish request is too large.', 413)
    const raw = await c.req.text()
    if (raw.length > 8192) throw new AppError('VALIDATION_FAILED', 'Publish request is too large.', 413)
    let body: unknown
    try { body = JSON.parse(raw) } catch { throw new AppError('VALIDATION_FAILED', 'Publish request must be valid JSON.', 400) }
    return c.json(await publishService(c.env).publish(body), 201)
  } catch (error) { return jsonError(c, error) }
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

type PageName = 'dashboard' | 'posts' | 'post-detail' | 'compose' | 'engagement' | 'insights' | 'activity' | 'settings'
const titles: Record<PageName, string> = { dashboard: 'Dashboard', posts: 'Posts', 'post-detail': 'Post detail', compose: 'Compose', engagement: 'Engagement', insights: 'Insights', activity: 'Activity', settings: 'Connection & Settings' }

function navLink(active: PageName, name: PageName, href: string, label: string): string {
  return `<a class="${active === name ? 'active' : ''}" href="${href}">${label}</a>`
}

function page(active: PageName) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titles[active]} · Threads Tools</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/style.css"></head>
<body data-page="${active}"><a class="skip-link" href="#main-content">Skip to content</a>
<div class="app-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">T</span><span>Threads Tools</span></a>
<nav aria-label="Primary navigation">${navLink(active, 'dashboard', '/', 'Dashboard')}${navLink(active, 'posts', '/posts', 'Posts')}${navLink(active, 'compose', '/compose', 'Compose')}${navLink(active, 'engagement', '/engagement', 'Engagement')}${navLink(active, 'insights', '/insights', 'Insights')}${navLink(active, 'activity', '/activity', 'Activity')}${navLink(active, 'settings', '/settings', 'Connection / Settings')}</nav>
<p class="phase-label">Phase 4 · Operator polish</p></aside>
<main id="main-content"><header class="topbar"><div><p class="eyebrow">Operator console</p><h1>${titles[active]}</h1></div><button id="sign-out" class="button ghost hidden" type="button">Sign out</button></header>
<section id="configuration-alert" class="alert warning hidden" role="status"></section>
<section id="login-panel" class="panel auth-panel hidden" aria-labelledby="login-title"><p class="eyebrow">Protected workspace</p><h2 id="login-title">Operator sign in</h2><p>Enter the server-configured operator password to access real Threads data.</p><form id="login-form"><label class="sr-only" for="operator-username">Username</label><input class="sr-only" id="operator-username" name="username" type="text" autocomplete="username" value="operator" tabindex="-1"><label for="password">Operator password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="button primary" type="submit">Sign in</button><p id="login-error" class="form-error" role="alert"></p></form></section>
<section id="workspace" class="hidden">${content(active)}</section>
</main></div><script type="module" src="/static/app.js"></script></body></html>`
}

function content(active: PageName): string {
  if (active === 'settings') return `<div class="page-intro"><p>Connect one real Threads account through the server-side OAuth flow. Reconnect to grant Phase 3 publishing and existing read permissions.</p></div><section class="panel" aria-labelledby="connection-title"><div class="panel-heading"><div><p class="eyebrow">Threads account</p><h2 id="connection-title">Connection status</h2></div><span id="status-badge" class="badge neutral">Checking</span></div><div id="connection-loading" class="skeleton-lines"><span></span><span></span></div><div id="connection-content" class="hidden"></div></section><section class="panel security-note"><h2>Security boundary</h2><p>Authorization codes and tokens remain server-side. Tokens are encrypted in D1 and provider responses are normalized before reaching this browser.</p></section>`
  if (active === 'dashboard') return `<section class="dashboard-actions"><a class="button primary" href="/compose">Compose post</a><a class="button secondary" href="/posts">Browse posts</a></section><section id="dashboard-health" class="panel state-panel" aria-live="polite"><div class="skeleton-lines"><span></span></div></section><section id="dashboard-account" class="panel state-panel" aria-live="polite"><div class="skeleton-lines"><span></span><span></span></div></section><section class="summary-grid"><article id="dashboard-engagement" class="panel state-panel"><div class="skeleton-lines"><span></span><span></span></div></article><article id="dashboard-insights" class="panel state-panel"><div class="skeleton-lines"><span></span><span></span></div></article></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Latest activity</p><h2>Recent posts</h2></div><a href="/posts">View all</a></div><div id="dashboard-posts" class="post-list"><div class="skeleton-lines"><span></span><span></span></div></div></section>`
  if (active === 'posts') return `<div class="page-intro"><p>Search and sort only the bounded pages loaded below. Load More preserves provider cursor pagination.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Owned media</p><h2>Your Threads posts</h2></div><span id="posts-count" class="badge neutral">Loading</span></div><form id="posts-controls" class="operator-controls" role="search"><label for="posts-search">Search loaded post text</label><input id="posts-search" type="search" placeholder="Search loaded posts…"><label for="posts-sort">Sort</label><select id="posts-sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></form><p id="posts-filter-note" class="muted-text" role="status"></p><div id="posts-list" class="post-list"><div class="skeleton-lines"><span></span><span></span></div></div><button id="load-more-posts" class="button secondary hidden" type="button">Load more</button></section>`
  if (active === 'post-detail') return `<div class="page-intro"><a class="text-link" href="/posts">← Back to posts</a><p>Real post context, available metrics, and top-level replies.</p></div><section id="post-detail" class="panel" aria-live="polite"><div class="skeleton-lines"><span></span><span></span></div></section><section class="summary-grid"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Available metrics</p><h2>Post insights</h2></div></div><div id="post-detail-metrics" class="metric-grid"><div class="skeleton-lines"><span></span></div></div></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Engagement</p><h2>Top-level replies</h2></div></div><div id="post-detail-replies"><div class="skeleton-lines"><span></span></div></div></article></section>`
  if (active === 'compose') return `<div class="page-intro"><p>Write, review, and explicitly publish a real text post to the connected Threads account.</p></div><section id="compose-account" class="panel compact-panel" aria-live="polite"><div class="skeleton-lines"><span></span></div></section><div class="compose-layout"><section class="panel" aria-labelledby="compose-title"><div class="panel-heading"><div><p class="eyebrow">Text post</p><h2 id="compose-title">Create a Thread</h2></div><span id="compose-validity" class="badge neutral">Empty</span></div><form id="compose-form" novalidate><label for="post-text">Post text</label><textarea id="post-text" name="text" rows="9" placeholder="Share something useful…" aria-describedby="compose-count compose-validation" required></textarea><div class="compose-meta"><p id="compose-validation" class="form-error" role="alert"></p><p id="compose-count" class="character-count">0 / 500 UTF-8 bytes</p></div><aside class="capability-note"><strong>Text publishing only in this phase</strong><p>Image and video controls are not shown because Threads requires provider-accessible public media URLs and media processing that are not configured in this console.</p></aside><button id="publish-button" class="button primary" type="submit" disabled>Publish to Threads</button></form></section><aside class="panel preview-panel" aria-labelledby="preview-title"><div class="panel-heading"><div><p class="eyebrow">Review</p><h2 id="preview-title">Post preview</h2></div></div><article class="thread-preview"><div class="account-avatar small" aria-hidden="true">T</div><div><strong id="preview-account">Connected account</strong><p id="preview-text" class="muted-text">Your post preview will appear here.</p></div></article><p class="preview-disclaimer">Preview approximates text content. Threads controls final rendering and link previews.</p></aside></div><section id="publish-result" class="panel hidden" aria-live="polite"></section>`
  if (active === 'engagement') return `<div class="page-intro"><p>Read-only top-level replies for your posts, when <code>threads_read_replies</code> is granted.</p></div><div class="split-layout"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Choose a post</p><h2>Recent posts</h2></div></div><div id="engagement-posts" class="compact-list"><div class="skeleton-lines"><span></span><span></span></div></div></section><section class="panel"><div id="selected-post-context" class="selected-context"><p class="muted-text">Select a post to inspect its context.</p></div><div class="panel-heading"><div><p class="eyebrow">Conversation</p><h2>Top-level replies</h2></div><span id="replies-status" class="badge neutral">Waiting</span></div><div id="replies-list" class="reply-list"><div class="empty-state"><h3>Select a post</h3><p>Choose a recent post to load its supported replies.</p></div></div><button id="load-more-replies" class="button secondary hidden" type="button">Load more replies</button></section></div>`
  if (active === 'activity') return `<div class="page-intro"><p>Safe operational history only. Credentials, provider payloads, and post text are never recorded here.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Audit trail</p><h2>Recent activity</h2></div><span id="audit-status" class="badge neutral">Loading</span></div><div id="audit-list" class="activity-list"><div class="skeleton-lines"><span></span><span></span></div></div><button id="load-more-audit" class="button secondary hidden" type="button">Load more activity</button></section>`
  return `<div class="page-intro"><p>Metrics currently exposed by the Threads Insights API. Unavailable values remain unavailable rather than becoming zero.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Period comparison</p><h2>Account metric comparison</h2></div><label for="insight-period">Period <select id="insight-period"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label></div><div id="insight-comparison" class="comparison-list"><div class="skeleton-lines"><span></span></div></div></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Account</p><h2>Account insights</h2></div><span id="account-insights-status" class="badge neutral">Loading</span></div><div id="account-insights" class="metric-grid"><div class="skeleton-lines"><span></span><span></span></div></div></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Content</p><h2>Post insights</h2></div></div><div id="insight-posts" class="insight-list"><div class="skeleton-lines"><span></span><span></span></div></div></section>`
}

app.get('/', (c) => c.html(page('dashboard')))
app.get('/posts', (c) => c.html(page('posts')))
app.get('/posts/:id', (c) => c.html(page('post-detail')))
app.get('/compose', (c) => c.html(page('compose')))
app.get('/engagement', (c) => c.html(page('engagement')))
app.get('/insights', (c) => c.html(page('insights')))
app.get('/activity', (c) => c.html(page('activity')))
app.get('/settings', (c) => c.html(page('settings')))

app.onError((error, c) => jsonError(c, error))
app.notFound((c) => c.html('<h1>Not found</h1><p><a href="/">Return to Threads Tools</a></p>', 404))

export default app
