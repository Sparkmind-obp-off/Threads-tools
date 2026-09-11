import { Hono, type Context } from 'hono'
import { getConfig, missingConfiguration, type Env } from './config/env'
import { productionConfigurationStatus } from './config/production'
import { AppError } from './domain/types'
import { MetaThreadsProvider } from './threads/adapter'
import { D1AuditStore, D1ConnectionStore, D1OAuthStateStore, D1PublishRequestStore } from './storage/repositories'
import { OAuthService } from './services/oauth'
import { ThreadsReadService } from './services/read'
import { ThreadsPublishService } from './services/publish'

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

function provider(env: Env): MetaThreadsProvider { return new MetaThreadsProvider(getConfig(env)) }
function connectionStore(env: Env): D1ConnectionStore { return new D1ConnectionStore(env.DB, env.SESSION_SECRET?.trim() || '') }
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

app.all('/api/session', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'No in-app operator session is used.' } }, 404))

app.get('/api/configuration', (c) => {
  const missing = missingConfiguration(c.env)
  c.header('Cache-Control', 'no-store')
  return c.json(productionConfigurationStatus(c.env, c.req.url, missing))
})

// Phase 5.1 deliberately exposes no configuration-write route. A Cloudflare
// Pages write credential may only be used after deployment-level owner
// authorization and secure server-side credential storage are provisioned.
app.all('/api/configuration/apply', (c) => c.json({
  error: {
    code: 'OWNER_AUTHORIZATION_REQUIRED',
    message: 'Production configuration writes are disabled. Use the owner-only Cloudflare setup checklist.',
    retryable: false,
    reauthorizationRequired: false,
  },
}, 403))

app.get('/api/connection/status', async (c) => {
  try {
    if (!c.env.SESSION_SECRET?.trim()) return c.json({ status: 'disconnected' as const })
    return c.json(await connectionStore(c.env).getSafe())
  } catch (error) { return jsonError(c, error) }
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
    return c.redirect(`/setup?result=error&code=${encodeURIComponent(normalized.code)}`, 302)
  }
})

app.get('/auth/threads/callback', async (c) => {
  try {
    await oauthService(c.env).callback({
      state: c.req.query('state'), code: c.req.query('code'), error: c.req.query('error'),
      errorDescription: c.req.query('error_description'),
    })
    return c.redirect('/setup?result=connected', 303)
  } catch (error) {
    const normalized = safeError(error)
    return c.redirect(`/setup?result=error&code=${encodeURIComponent(normalized.code)}`, 303)
  }
})

type PageName = 'setup' | 'dashboard' | 'posts' | 'post-detail' | 'compose' | 'engagement' | 'insights' | 'activity' | 'settings'
const titles: Record<PageName, string> = { setup: 'Production Configuration Center', dashboard: 'Dashboard', posts: 'Posts', 'post-detail': 'Post detail', compose: 'Compose', engagement: 'Engagement', insights: 'Insights', activity: 'Activity', settings: 'Connection & Settings' }

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
<p class="phase-label">Phase 5 · Personal setup</p></aside>
<main id="main-content"><header class="topbar"><div><p class="eyebrow">Personal operator console</p><h1>${titles[active]}</h1></div>${active === 'setup' ? '<a class="button ghost" href="/settings">Settings</a>' : '<a class="button ghost" href="/setup">Review setup</a>'}</header>
<section id="configuration-alert" class="alert warning hidden" role="status"></section>
<section id="workspace">${content(active)}</section>
</main></div><script type="module" src="/static/app.js"></script></body></html>`
}

function content(active: PageName): string {
  if (active === 'setup') return `<div class="page-intro"><p>Configure the Production environment, verify safe readiness, connect the owner’s Threads account, and continue to the dashboard.</p></div><section class="panel setup-panel" aria-labelledby="setup-welcome-title"><p class="eyebrow">Personal Operator Setup · Private single-owner tool</p><h2 id="setup-welcome-title">Production Configuration Center</h2><p>Server secrets are checked only as safe readiness states. This page reports Configured or Missing, never returns secret values, and has no mystery in-app operator password. Protect every production route with Cloudflare Access.</p></section><section class="panel" aria-labelledby="bridge-title"><div class="panel-heading"><div><p class="eyebrow">Cloudflare configuration bridge</p><h2 id="bridge-title">Owner authorization</h2></div><span id="setup-bridge-badge" class="badge neutral">Checking</span></div><div id="setup-bridge"><div class="skeleton-lines"><span></span></div></div></section><section class="panel" aria-labelledby="readiness-title"><div class="panel-heading"><div><p class="eyebrow">Production environment</p><h2 id="readiness-title">Configuration readiness</h2></div><span id="setup-config-badge" class="badge neutral">Checking</span></div><div id="setup-readiness" class="readiness-list"><div class="skeleton-lines"><span></span><span></span></div></div><div class="actions setup-actions"><button id="recheck-configuration" class="button secondary" type="button">Re-check Configuration</button><a id="open-cloudflare" class="button ghost" href="https://dash.cloudflare.com/?to=/:account/workers-and-pages" target="_blank" rel="noopener noreferrer">Open Cloudflare</a></div><p class="muted-text">Secrets remain encrypted server bindings. This browser receives status and safe setup metadata only.</p></section><section id="manual-setup" class="panel" aria-labelledby="manual-setup-title"><div class="panel-heading"><div><p class="eyebrow">Secure one-time fallback</p><h2 id="manual-setup-title">Configure Cloudflare Production</h2></div><span class="badge warning">Manual action</span></div><p>The official Pages API supports Production variables and encrypted <code>secret_text</code> bindings, but this deployment has no dedicated Cloudflare OAuth client or secure server-side authorization store. For safety, it does not accept raw API tokens or expose a configuration-write endpoint.</p><ol class="setup-checklist"><li>Open Cloudflare project <code>threads-tools</code>.</li><li>Open <strong>Settings → Variables and Secrets</strong> and select the <strong>Production</strong> environment.</li><li>Add the exact bindings below using the indicated type.</li><li>Save the bindings and redeploy if Cloudflare indicates a deployment is required.</li><li>Return here and select <strong>Re-check Configuration</strong>.</li><li>When every required item is ready, select <strong>Connect Threads</strong>.</li></ol><div class="configuration-reference" role="table" aria-label="Required Cloudflare Production bindings"><div class="reference-row" role="row"><code role="cell">THREADS_APP_ID</code><span role="cell">Variable</span><button class="copy-button" type="button" data-copy-value="THREADS_APP_ID">Copy name</button></div><div class="reference-row" role="row"><code role="cell">THREADS_APP_SECRET</code><span role="cell">Encrypted Secret</span><button class="copy-button" type="button" data-copy-value="THREADS_APP_SECRET">Copy name</button></div><div class="reference-row" role="row"><code role="cell">THREADS_REDIRECT_URI</code><span role="cell">Variable</span><button class="copy-button" type="button" data-copy-value="THREADS_REDIRECT_URI">Copy name</button></div><div class="reference-row" role="row"><code role="cell">THREADS_API_BASE_URL</code><span role="cell">Variable · optional default</span><button class="copy-button" type="button" data-copy-value="THREADS_API_BASE_URL">Copy name</button></div><div class="reference-row" role="row"><code role="cell">SESSION_SECRET</code><span role="cell">Encrypted Secret · 32+ chars</span><button class="copy-button" type="button" data-copy-value="SESSION_SECRET">Copy name</button></div></div><div class="safe-copy-card"><div><strong>Production Redirect URI</strong><code id="redirect-uri-suggestion">Loading safe value…</code></div><button id="copy-redirect-uri" class="button secondary" type="button">Copy Redirect URI</button></div></section><section class="panel" aria-labelledby="setup-connection-title"><div class="panel-heading"><div><p class="eyebrow">Threads account</p><h2 id="setup-connection-title">Connection</h2></div><span id="setup-connection-badge" class="badge neutral">Checking</span></div><div id="setup-connection"><div class="skeleton-lines"><span></span></div></div></section>`
  if (active === 'settings') return `<div class="page-intro"><p>Connect one real Threads account through the server-side OAuth flow. Reconnect to grant publishing and existing read permissions.</p></div><section class="panel compact-panel"><div class="connected-strip"><span class="badge neutral">Personal setup</span><div><strong>Review setup at any time</strong><p>Check safe configuration readiness and connection state without exposing server values.</p></div><a class="button secondary" href="/setup">Open setup</a></div></section><section class="panel" aria-labelledby="connection-title"><div class="panel-heading"><div><p class="eyebrow">Threads account</p><h2 id="connection-title">Connection status</h2></div><span id="status-badge" class="badge neutral">Checking</span></div><div id="connection-loading" class="skeleton-lines"><span></span><span></span></div><div id="connection-content" class="hidden"></div></section><section class="panel security-note"><h2>Security boundary</h2><p>Authorization codes and tokens remain server-side. Tokens are encrypted in D1 and provider responses are normalized before reaching this browser. This app has no separate in-app operator password; protect a public deployment with Cloudflare Access.</p></section>`
  if (active === 'dashboard') return `<section class="dashboard-actions"><a class="button primary" href="/compose">Compose post</a><a class="button secondary" href="/posts">Browse posts</a></section><section id="dashboard-health" class="panel state-panel" aria-live="polite"><div class="skeleton-lines"><span></span></div></section><section id="dashboard-account" class="panel state-panel" aria-live="polite"><div class="skeleton-lines"><span></span><span></span></div></section><section class="summary-grid"><article id="dashboard-engagement" class="panel state-panel"><div class="skeleton-lines"><span></span><span></span></div></article><article id="dashboard-insights" class="panel state-panel"><div class="skeleton-lines"><span></span><span></span></div></article></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Latest activity</p><h2>Recent posts</h2></div><a href="/posts">View all</a></div><div id="dashboard-posts" class="post-list"><div class="skeleton-lines"><span></span><span></span></div></div></section>`
  if (active === 'posts') return `<div class="page-intro"><p>Search and sort only the bounded pages loaded below. Load More preserves provider cursor pagination.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Owned media</p><h2>Your Threads posts</h2></div><span id="posts-count" class="badge neutral">Loading</span></div><form id="posts-controls" class="operator-controls" role="search"><label for="posts-search">Search loaded post text</label><input id="posts-search" type="search" placeholder="Search loaded posts…"><label for="posts-sort">Sort</label><select id="posts-sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></form><p id="posts-filter-note" class="muted-text" role="status"></p><div id="posts-list" class="post-list"><div class="skeleton-lines"><span></span><span></span></div></div><button id="load-more-posts" class="button secondary hidden" type="button">Load more</button></section>`
  if (active === 'post-detail') return `<div class="page-intro"><a class="text-link" href="/posts">← Back to posts</a><p>Real post context, available metrics, and top-level replies.</p></div><section id="post-detail" class="panel" aria-live="polite"><div class="skeleton-lines"><span></span><span></span></div></section><section class="summary-grid"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Available metrics</p><h2>Post insights</h2></div></div><div id="post-detail-metrics" class="metric-grid"><div class="skeleton-lines"><span></span></div></div></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">Engagement</p><h2>Top-level replies</h2></div></div><div id="post-detail-replies"><div class="skeleton-lines"><span></span></div></div></article></section>`
  if (active === 'compose') return `<div class="page-intro"><p>Write, review, and explicitly publish a real text post to the connected Threads account.</p></div><section id="compose-account" class="panel compact-panel" aria-live="polite"><div class="skeleton-lines"><span></span></div></section><div class="compose-layout"><section class="panel" aria-labelledby="compose-title"><div class="panel-heading"><div><p class="eyebrow">Text post</p><h2 id="compose-title">Create a Thread</h2></div><span id="compose-validity" class="badge neutral">Empty</span></div><form id="compose-form" novalidate><label for="post-text">Post text</label><textarea id="post-text" name="text" rows="9" placeholder="Share something useful…" aria-describedby="compose-count compose-validation" required></textarea><div class="compose-meta"><p id="compose-validation" class="form-error" role="alert"></p><p id="compose-count" class="character-count">0 / 500 UTF-8 bytes</p></div><aside class="capability-note"><strong>Text publishing only in this phase</strong><p>Image and video controls are not shown because Threads requires provider-accessible public media URLs and media processing that are not configured in this console.</p></aside><button id="publish-button" class="button primary" type="submit" disabled>Publish to Threads</button></form></section><aside class="panel preview-panel" aria-labelledby="preview-title"><div class="panel-heading"><div><p class="eyebrow">Review</p><h2 id="preview-title">Post preview</h2></div></div><article class="thread-preview"><div class="account-avatar small" aria-hidden="true">T</div><div><strong id="preview-account">Connected account</strong><p id="preview-text" class="muted-text">Your post preview will appear here.</p></div></article><p class="preview-disclaimer">Preview approximates text content. Threads controls final rendering and link previews.</p></aside></div><section id="publish-result" class="panel hidden" aria-live="polite"></section>`
  if (active === 'engagement') return `<div class="page-intro"><p>Read-only top-level replies for your posts, when <code>threads_read_replies</code> is granted.</p></div><div class="split-layout"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Choose a post</p><h2>Recent posts</h2></div></div><div id="engagement-posts" class="compact-list"><div class="skeleton-lines"><span></span><span></span></div></div></section><section class="panel"><div id="selected-post-context" class="selected-context"><p class="muted-text">Select a post to inspect its context.</p></div><div class="panel-heading"><div><p class="eyebrow">Conversation</p><h2>Top-level replies</h2></div><span id="replies-status" class="badge neutral">Waiting</span></div><div id="replies-list" class="reply-list"><div class="empty-state"><h3>Select a post</h3><p>Choose a recent post to load its supported replies.</p></div></div><button id="load-more-replies" class="button secondary hidden" type="button">Load more replies</button></section></div>`
  if (active === 'activity') return `<div class="page-intro"><p>Safe operational history only. Credentials, provider payloads, and post text are never recorded here.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Audit trail</p><h2>Recent activity</h2></div><span id="audit-status" class="badge neutral">Loading</span></div><div id="audit-list" class="activity-list"><div class="skeleton-lines"><span></span><span></span></div></div><button id="load-more-audit" class="button secondary hidden" type="button">Load more activity</button></section>`
  return `<div class="page-intro"><p>Metrics currently exposed by the Threads Insights API. Unavailable values remain unavailable rather than becoming zero.</p></div><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Period comparison</p><h2>Account metric comparison</h2></div><label for="insight-period">Period <select id="insight-period"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label></div><div id="insight-comparison" class="comparison-list"><div class="skeleton-lines"><span></span></div></div></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Account</p><h2>Account insights</h2></div><span id="account-insights-status" class="badge neutral">Loading</span></div><div id="account-insights" class="metric-grid"><div class="skeleton-lines"><span></span><span></span></div></div></section><section class="panel"><div class="panel-heading"><div><p class="eyebrow">Content</p><h2>Post insights</h2></div></div><div id="insight-posts" class="insight-list"><div class="skeleton-lines"><span></span><span></span></div></div></section>`
}

app.get('/setup', (c) => c.html(page('setup')))
app.get('/', (c) => c.html(page('dashboard')))
app.get('/posts', (c) => c.html(page('posts')))
app.get('/posts/:id', (c) => c.html(page('post-detail')))
app.get('/compose', (c) => c.html(page('compose')))
app.get('/engagement', (c) => c.html(page('engagement')))
app.get('/insights', (c) => c.html(page('insights')))
app.get('/activity', (c) => c.html(page('activity')))
app.get('/settings', (c) => c.html(page('settings')))

app.all('*', (c) => c.html('<h1>Not found</h1><p><a href="/">Return to Threads Tools</a></p>', 404))
app.onError((error, c) => jsonError(c, error))

export default app
