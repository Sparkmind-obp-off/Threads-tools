import { Hono, type Context } from 'hono'
import { getConfig, missingConfiguration, type Env } from './config/env'
import { cloudflareOAuthConfigured, ownerBoundaryConfigured, productionConfigurationStatus } from './config/production'
import { AppError } from './domain/types'
import { assertSameOrigin, requireOwner } from './auth/owner'
import { CloudflareOAuthClient, CloudflareOAuthService, D1CloudflareOAuthStore } from './cloudflare/oauth'
import { CloudflarePagesApi, CloudflarePagesApiError, type ProductionConfigurationInput } from './cloudflare/pages'
import { MetaThreadsProvider } from './threads/adapter'
import { D1AuditStore, D1ConnectionStore, D1OAuthStateStore, D1PublishRequestStore } from './storage/repositories'
import { OAuthService } from './services/oauth'
import { ThreadsReadService } from './services/read'
import { ThreadsPublishService } from './services/publish'
import daytonaRoutes from './sparkpod/daytona-routes'

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
  if (error instanceof CloudflarePagesApiError) {
    if (error.code === 'AUTHORIZATION_INVALID') return new AppError('CLOUDFLARE_AUTHORIZATION_EXPIRED', error.message, 401)
    if (error.code === 'PROJECT_BOUNDARY_VIOLATION') return new AppError('PROJECT_BOUNDARY_VIOLATION', error.message, 403)
    return new AppError('CLOUDFLARE_API_FAILURE', error.message, 502, true)
  }
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

async function requireSetupOwner(c: Context<{ Bindings: Env }>): Promise<void> {
  await requireOwner(c.req.header('Cf-Access-Jwt-Assertion'), {
    teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
    audience: c.env.CF_ACCESS_AUD,
    ownerEmail: c.env.OWNER_EMAIL,
  })
}

function cloudflareStore(env: Env): D1CloudflareOAuthStore {
  if (!env.SESSION_SECRET?.trim() || env.SESSION_SECRET.length < 32) throw new AppError('CONFIGURATION_MISSING', 'A valid session/token encryption secret is required.', 503)
  return new D1CloudflareOAuthStore(env.DB, env.SESSION_SECRET)
}

function cloudflareOAuth(env: Env, requestUrl: string): CloudflareOAuthService {
  if (!cloudflareOAuthConfigured(env)) throw new AppError('CLOUDFLARE_OAUTH_NOT_CONFIGURED', 'Create and configure the private Cloudflare OAuth client first.', 503)
  const scopes = env.CLOUDFLARE_OAUTH_SCOPES!.trim().split(/\s+/).filter(Boolean)
  return new CloudflareOAuthService(new CloudflareOAuthClient({
    clientId: env.CLOUDFLARE_OAUTH_CLIENT_ID!.trim(),
    clientSecret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET!,
    redirectUri: `${new URL(requestUrl).origin}/auth/cloudflare/callback`,
    scopes,
  }), cloudflareStore(env))
}

async function cloudflareApi(env: Env): Promise<{ api: CloudflarePagesApi; credential: Awaited<ReturnType<D1CloudflareOAuthStore['getCredential']>> }> {
  const credential = await cloudflareStore(env).getCredential()
  if (!credential) throw new AppError('CLOUDFLARE_NOT_CONNECTED', 'Connect Cloudflare before continuing.', 409)
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) throw new AppError('CLOUDFLARE_AUTHORIZATION_EXPIRED', 'Cloudflare authorization expired. Reconnect Cloudflare.', 401)
  return { api: new CloudflarePagesApi(credential.accessToken), credential }
}

function parseConfigurationInput(value: unknown, requestUrl: string): ProductionConfigurationInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const appId = typeof body.THREADS_APP_ID === 'string' ? body.THREADS_APP_ID.trim() : ''
  const appSecret = typeof body.THREADS_APP_SECRET === 'string' ? body.THREADS_APP_SECRET.trim() : ''
  if (!/^\d{3,40}$/.test(appId)) throw new AppError('VALIDATION_FAILED', 'Threads App ID must be 3–40 digits.', 400)
  if (appSecret.length < 8 || appSecret.length > 512) throw new AppError('VALIDATION_FAILED', 'Threads App Secret must be 8–512 characters.', 400)
  return {
    THREADS_APP_ID: appId,
    THREADS_APP_SECRET: appSecret,
    THREADS_REDIRECT_URI: `${new URL(requestUrl).origin}/auth/threads/callback`,
    THREADS_API_BASE_URL: 'https://graph.threads.com',
    THREADS_API_VERSION: 'v1.0',
  }
}

app.all('/api/session', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'No in-app operator session is used.' } }, 404))

app.get('/api/configuration', (c) => {
  const missing = missingConfiguration(c.env)
  c.header('Cache-Control', 'no-store')
  return c.json(productionConfigurationStatus(c.env, c.req.url, missing))
})

app.get('/auth/cloudflare/start', async (c) => {
  try {
    await requireSetupOwner(c)
    return c.redirect(await cloudflareOAuth(c.env, c.req.url).start(), 302)
  } catch (error) {
    const normalized = safeError(error)
    return c.redirect(`/setup?cloudflare=error&code=${encodeURIComponent(normalized.code)}`, 302)
  }
})

app.get('/auth/cloudflare/callback', async (c) => {
  try {
    await requireSetupOwner(c)
    await cloudflareOAuth(c.env, c.req.url).callback({
      state: c.req.query('state'), code: c.req.query('code'), error: c.req.query('error'),
    })
    return c.redirect('/setup?cloudflare=connected', 303)
  } catch (error) {
    const normalized = safeError(error)
    return c.redirect(`/setup?cloudflare=error&code=${encodeURIComponent(normalized.code)}`, 303)
  }
})

app.get('/api/cloudflare/status', async (c) => {
  try {
    await requireSetupOwner(c)
    c.header('Cache-Control', 'no-store')
    return c.json(await cloudflareStore(c.env).safeStatus(new Date()))
  } catch (error) { return jsonError(c, error) }
})

app.get('/api/cloudflare/resources', async (c) => {
  try {
    await requireSetupOwner(c)
    const { api } = await cloudflareApi(c.env)
    const accounts = await api.listAccounts()
    const resources = await Promise.all(accounts.map(async (account) => ({
      ...account, projects: await api.listProjects(account.id),
    })))
    c.header('Cache-Control', 'no-store')
    return c.json({ accounts: resources })
  } catch (error) { return jsonError(c, error) }
})

app.post('/api/cloudflare/project', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const accountId = typeof body.accountId === 'string' ? body.accountId : ''
    const projectName = typeof body.projectName === 'string' ? body.projectName : ''
    if (!/^[a-f0-9]{32}$/i.test(accountId) || !/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$|^[a-z0-9]$/i.test(projectName)) {
      throw new AppError('VALIDATION_FAILED', 'Choose a valid authorized account and Pages project.', 400)
    }
    const { api } = await cloudflareApi(c.env)
    const accounts = await api.listAccounts()
    const account = accounts.find((item) => item.id === accountId)
    if (!account) throw new AppError('PROJECT_BOUNDARY_VIOLATION', 'The selected account is not authorized.', 403)
    await api.verifyProjectBoundary(accountId, projectName)
    await cloudflareStore(c.env).selectProject(accountId, account.name, projectName, new Date())
    return c.json({ status: 'selected', accountId, accountName: account.name, projectName })
  } catch (error) { return jsonError(c, error) }
})

app.post('/api/cloudflare/disconnect', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    await cloudflareStore(c.env).disconnect()
    return c.json({ status: 'not_connected' })
  } catch (error) { return jsonError(c, error) }
})

app.get('/api/configuration/production', async (c) => {
  try {
    await requireSetupOwner(c)
    const { api, credential } = await cloudflareApi(c.env)
    if (!credential?.accountId || !credential.projectName) throw new AppError('CLOUDFLARE_PROJECT_REQUIRED', 'Select the authorized Pages project first.', 409)
    c.header('Cache-Control', 'no-store')
    return c.json(await api.configurationStatus(credential.accountId, credential.projectName))
  } catch (error) { return jsonError(c, error) }
})

app.post('/api/configuration/apply', async (c) => {
  try {
    await requireSetupOwner(c)
    assertSameOrigin(c.req.url, c.req.header('Origin'))
    const contentLength = Number(c.req.header('content-length') || 0)
    if (contentLength > 2048) throw new AppError('VALIDATION_FAILED', 'Configuration request is too large.', 413)
    const input = parseConfigurationInput(await c.req.json().catch(() => ({})), c.req.url)
    const { api, credential } = await cloudflareApi(c.env)
    if (!credential?.accountId || !credential.projectName) throw new AppError('CLOUDFLARE_PROJECT_REQUIRED', 'Select the authorized Pages project first.', 409)
    const status = await api.updateProduction(credential.accountId, credential.projectName, input)
    return c.json({ ...status, deploymentRequired: true, message: 'Production bindings were verified. Redeploy the Pages project before the running application can use changed values.' })
  } catch (error) { return jsonError(c, error) }
})

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

app.route('/api/sparkpod/daytona', daytonaRoutes)

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

function setupContent(): string {
  return `<div class="page-intro"><p>Authorize the owner, connect Cloudflare, safely apply Threads configuration to Pages Production, then connect Threads.</p></div>
  <section class="panel setup-panel" aria-labelledby="setup-welcome-title"><p class="eyebrow">Private single-owner tool</p><h2 id="setup-welcome-title">Production Configuration Center</h2><p>Cloudflare and Threads credentials stay server-side. Protect this application with Cloudflare Access; every bridge route verifies its signed owner assertion.</p></section>
  <section id="sparkpod" class="panel sparkpod-panel" aria-labelledby="sparkpod-title">
    <div class="panel-heading"><div><p class="eyebrow">Remote execution foundation</p><h2 id="sparkpod-title">SparkPod</h2></div><span id="sparkpod-status-badge" class="badge neutral">Checking</span></div>
    <p class="sparkpod-purpose">SparkPod is the remote execution layer behind the future AI Business Operator. This phase validates the secure execution foundation—not a browser IDE or workspace.</p>
    <dl class="sparkpod-metadata">
      <div><dt>Provider</dt><dd>Daytona</dd></div>
      <div><dt>Credential</dt><dd>Cloudflare Production Secret<br><code>DAYTONA_API_KEY</code></dd></div>
      <div><dt>Status</dt><dd id="sparkpod-status-text">Checking configuration…</dd></div>
    </dl>
    <div class="sparkpod-flow" aria-label="SparkPod connection test flow"><strong>Test flow</strong><span>Create sandbox</span><i aria-hidden="true">→</i><span>Execute command</span><i aria-hidden="true">→</i><span>Verify result</span><i aria-hidden="true">→</i><span>Delete sandbox</span></div>
    <div class="actions"><button id="test-sparkpod" class="button secondary" type="button" disabled>Test Connection</button></div>
    <div id="sparkpod-test-result" class="sparkpod-test-result hidden" aria-live="polite"></div>
  </section>
  <section class="panel" aria-labelledby="bridge-title"><div class="panel-heading"><div><p class="eyebrow">Cloudflare connection</p><h2 id="bridge-title">Owner-authorized Pages access</h2></div><span id="setup-bridge-badge" class="badge neutral">Checking</span></div><div id="setup-bridge"><div class="skeleton-lines"><span></span></div></div></section>
  <section id="project-section" class="panel hidden" aria-labelledby="project-title"><div class="panel-heading"><div><p class="eyebrow">Authorized resources</p><h2 id="project-title">Choose a Pages project</h2></div></div><form id="project-form"><label for="project-select">Account and Pages project</label><select id="project-select" required></select><div class="actions"><button class="button primary" type="submit">Confirm project</button><button id="disconnect-cloudflare" class="button danger" type="button">Disconnect Cloudflare</button></div></form></section>
  <section class="panel" aria-labelledby="readiness-title"><div class="panel-heading"><div><p class="eyebrow">Production environment</p><h2 id="readiness-title">Configuration readiness</h2></div><span id="setup-config-badge" class="badge neutral">Checking</span></div><div id="setup-readiness" class="readiness-list"><div class="skeleton-lines"><span></span><span></span></div></div><div class="actions setup-actions"><button id="recheck-configuration" class="button secondary" type="button">Re-check Configuration</button><button id="copy-redirect-uri" class="button ghost" type="button" data-copy-value="">Copy Redirect URI</button></div></section>
  <section id="automatic-configuration" class="panel hidden" aria-labelledby="automatic-title"><div class="panel-heading"><div><p class="eyebrow">Secure Production write</p><h2 id="automatic-title">Configure automatically</h2></div></div><form id="configuration-form" autocomplete="off"><label for="threads-app-id">Threads App ID</label><input id="threads-app-id" name="THREADS_APP_ID" inputmode="numeric" pattern="[0-9]{3,40}" required><label for="threads-app-secret">Threads App Secret</label><input id="threads-app-secret" name="THREADS_APP_SECRET" type="password" minlength="8" maxlength="512" autocomplete="new-password" required><p class="muted-text">The secret travels only to this authenticated same-origin server route and is never returned.</p><button class="button primary" type="submit">Apply Production</button></form><div id="configuration-result" aria-live="polite"></div></section>
  <section id="manual-setup" class="panel" aria-labelledby="manual-title"><div class="panel-heading"><div><p class="eyebrow">Owner bootstrap / fallback</p><h2 id="manual-title">Private Cloudflare OAuth client</h2></div></div><div id="manual-bootstrap"><div class="skeleton-lines"><span></span></div></div><p><strong>OAuth callback URL</strong><br><code id="cloudflare-callback-url">Checking…</code></p><p><strong>Threads callback URL</strong><br><code id="redirect-uri-suggestion">Checking…</code></p><div class="actions"><a id="open-oauth-clients" class="button secondary" href="https://dash.cloudflare.com/?to=/:account/oauth-clients" target="_blank" rel="noopener noreferrer">Open OAuth clients</a><a id="open-cloudflare" class="button ghost" href="https://dash.cloudflare.com/?to=/:account/workers-and-pages" target="_blank" rel="noopener noreferrer">Manual Variables / Secrets</a></div></section>
  <section class="panel" aria-labelledby="setup-connection-title"><div class="panel-heading"><div><p class="eyebrow">Threads account</p><h2 id="setup-connection-title">Connection</h2></div><span id="setup-connection-badge" class="badge neutral">Checking</span></div><div id="setup-connection"><div class="skeleton-lines"><span></span></div></div></section>`
}

function content(active: PageName): string {
  if (active === 'setup') return setupContent()
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
