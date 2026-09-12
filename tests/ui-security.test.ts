import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import app from '../src/index'

function environment(connection?: Record<string, string | null>) {
  const statement = {
    bind() { return statement },
    async first() { return connection ?? null },
    async run() { return { meta: { changes: 0 } } },
    async all() { return { results: [] } },
  }
  return {
    DB: { prepare: () => statement },
    THREADS_APP_ID: 'public-app-id',
    THREADS_APP_SECRET: 'server-secret-value',
    THREADS_REDIRECT_URI: 'https://app.example.com/auth/threads/callback',
    THREADS_API_BASE_URL: 'https://graph.threads.com',
    SESSION_SECRET: 's'.repeat(32),
  } as never
}

function environmentMissing() {
  const statement = {
    bind() { return statement },
    async first() { return null },
    async run() { return { meta: { changes: 0 } } },
    async all() { return { results: [] } },
  }
  return { DB: { prepare: () => statement } } as never
}

describe('Phase 5 UI and browser security boundary', () => {
  it.each([
    ['/setup', 'Production Configuration Center'], ['/', 'Recent posts'], ['/posts', 'Your Threads posts'], ['/posts/10', 'Post insights'], ['/engagement', 'Top-level replies'],
    ['/compose', 'Create a Thread'], ['/insights', 'Account metric comparison'], ['/activity', 'Recent activity'], ['/settings', 'Connection status'],
  ])('renders the directly accessible real-data workspace shell for %s', async (path, label) => {
    const response = await app.request(path)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain(label)
    expect(html).not.toContain('Operator sign in')
    if (path !== '/setup') expect(html).not.toContain('type="password"')
    expect(html).not.toContain('server-secret')
    expect(html).not.toContain('access_token')
  })

  it('has no operator session/password endpoint or gate', async () => {
    const [session, dashboard, posts, insights] = await Promise.all([
      app.request('/api/session', { method: 'POST', body: JSON.stringify({ password: 'guess' }) }),
      app.request('/'), app.request('/posts'), app.request('/insights'),
    ])
    expect(session.status).toBe(404)
    expect(dashboard.status).toBe(200)
    expect(posts.status).toBe(200)
    expect(insights.status).toBe(200)
  })

  it('does not expose Daytona credential storage or disconnect routes', async () => {
    const [credentials, disconnect] = await Promise.all([
      app.request('/api/sparkpod/daytona/credentials', { method: 'POST' }),
      app.request('/api/sparkpod/daytona/disconnect', { method: 'POST' }),
    ])
    expect(credentials.status).toBe(404)
    expect(disconnect.status).toBe(404)
  })

  it('returns only safe configuration readiness states', async () => {
    const configured = await app.request('/api/configuration', undefined, environment())
    const configuredBody = await configured.json<Record<string, unknown>>()
    expect(configuredBody).toMatchObject({
      status: 'supported',
      readiness: {
        threadsAppId: 'configured', threadsAppSecret: 'configured', redirectUri: 'configured',
        apiBaseUrl: 'configured', sessionSecret: 'configured',
      },
    })
    const payload = JSON.stringify(configuredBody)
    expect(payload).not.toContain('server-secret-value')
    expect(payload).not.toContain('public-app-id')

    const missing = await app.request('/api/configuration', undefined, environmentMissing())
    expect(await missing.json()).toMatchObject({
      status: 'not_configured',
      readiness: { threadsAppId: 'missing', threadsAppSecret: 'missing', redirectUri: 'missing', sessionSecret: 'missing' },
    })
  })

  it('reports connected, disconnected, and expired connection state without credentials', async () => {
    const connectedRow = {
      account_id: '42', username: 'owner', display_name: 'Owner',
      connected_at: '2026-09-11T10:00:00.000Z', token_expires_at: '2099-01-01T00:00:00.000Z',
    }
    const connected = await (await app.request('/api/connection/status', undefined, environment(connectedRow))).json<Record<string, unknown>>()
    const disconnected = await (await app.request('/api/connection/status', undefined, environment())).json<Record<string, unknown>>()
    const expired = await (await app.request('/api/connection/status', undefined, environment({ ...connectedRow, token_expires_at: '2020-01-01T00:00:00.000Z' }))).json<Record<string, unknown>>()
    expect(connected).toMatchObject({ status: 'connected', accountId: '42', username: 'owner' })
    expect(disconnected).toEqual({ status: 'disconnected' })
    expect(expired).toMatchObject({ status: 'connected', tokenExpiresAt: '2020-01-01T00:00:00.000Z' })
    expect(JSON.stringify([connected, disconnected, expired])).not.toContain('accessToken')
  })

  it('ships a bounded personal first-run and completed-state flow', async () => {
    const [setup, script] = await Promise.all([
      app.request('/setup'),
      readFile(new URL('../public/static/app.js', import.meta.url), 'utf8'),
    ])
    const html = await setup.text()
    expect(html).toContain('Configuration readiness')
    expect(html).toContain('Cloudflare and Threads credentials stay server-side')
    expect(html).toContain('Remote execution foundation')
    expect(html).toContain('SparkPod is the remote execution layer behind the future AI Business Operator')
    expect(html).toContain('Cloudflare Production Secret')
    expect(html).toContain('Cloudflare owner authorization')
    expect(html).toContain('Open Zero Trust Access')
    expect(html).toContain('DAYTONA_API_KEY')
    expect(html).toContain('Test Connection')
    expect(html).toContain('Create sandbox')
    expect(html).toContain('Wait until ready')
    expect(html).toContain('Execute command')
    expect(html).toContain('Verify result')
    expect(html).toContain('Delete sandbox')
    expect(html).toContain('Daytona Reachability Diagnostic')
    expect(html).toContain('Run Reachability Diagnostic')
    expect(html).not.toContain('name="apiKey"')
    expect(html).not.toContain('Connect Daytona')
    expect(html).not.toContain('Disconnect</button>')
    expect(script).toContain("localStorage.getItem(ONBOARDING_KEY) === 'true'")
    expect(script).toContain("localStorage.setItem(ONBOARDING_KEY, 'true')")
    expect(script).toContain('Continue to Dashboard')
    expect(script).toContain("location.replace('/setup')")
    expect(script).toContain('Reconnect required')
    expect(script).toContain('Sandbox creation failed')
    expect(script).toContain('Command execution failed')
    expect(script).toContain('Cleanup failed')
    expect(script).toContain('API contract mismatch')
    expect(script).toContain("statusText.textContent = 'Connected — five-step lifecycle verified'")
    expect(script).toContain("request('/api/sparkpod/daytona/preflight', { method: 'POST' })")
    expect(script).toContain('Cloudflare Access: Not configured')
    expect(script).toContain('CF_ACCESS_TEAM_DOMAIN')
    expect(script).toContain('configuration.actions.accessDashboardUrl')
    expect(script).toContain('✓ Daytona connected')
  })

  it('contains compose validation, preview, publishing, duplicate-click, success, error, and unsupported-media states', async () => {
    const [response, script] = await Promise.all([
      app.request('/compose'),
      readFile(new URL('../public/static/app.js', import.meta.url), 'utf8'),
    ])
    const html = await response.text()
    expect(html).toContain('Post preview')
    expect(html).toContain('Publish to Threads')
    expect(html).toContain('UTF-8 bytes')
    expect(html).toContain('Text publishing only')
    expect(html).toContain('id="publish-button" class="button primary" type="submit" disabled')
    expect(script).toContain("button.textContent = 'Publishing…'")
    expect(script).toContain('composePublishing')
    expect(script).toContain('PUBLISH_RESULT_UNCERTAIN')
    expect(script).toContain('Your Thread is live')
    expect(script).toContain('Connect Threads before publishing')
  })

  it('contains bounded post search, sorting, detail, contextual engagement, comparisons, and audit states', async () => {
    const html = async (path: string) => (await app.request(path)).text()
    const [posts, detail, engagement, insights, activity, script] = await Promise.all([
      html('/posts'),
      html('/posts/10'),
      html('/engagement'),
      html('/insights'),
      html('/activity'),
      readFile(new URL('../public/static/app.js', import.meta.url), 'utf8'),
    ])
    expect(posts).toContain('Search loaded post text')
    expect(posts).toContain('Newest first')
    expect(detail).toContain('Post detail')
    expect(engagement).toContain('selected-post-context')
    expect(insights).toContain('Period comparison')
    expect(activity).toContain('Credentials, provider payloads, and post text are never recorded')
    expect(script).toContain('Filtering')
    expect(script).toContain('followers_count')
    expect(script).toContain('reauthorization_required')
  })

  it('contains loading, empty, unsupported, error, and pagination UI states', async () => {
    const script = await readFile(new URL('../public/static/app.js', import.meta.url), 'utf8')
    expect(script).toContain('skeleton-lines')
    expect(script).toContain("'empty'")
    expect(script).toContain("'unsupported'")
    expect(script).toContain('recoveryState')
    expect(script).toContain('Load more')
  })

  it('does not ship server credentials or authorization headers in client assets', async () => {
    const [script, css] = await Promise.all([
      readFile(new URL('../public/static/app.js', import.meta.url), 'utf8'),
      readFile(new URL('../public/static/style.css', import.meta.url), 'utf8'),
    ])
    const assets = script + css
    expect(assets).not.toContain('server-secret-value')
    expect(assets).not.toContain('private-client-secret')
    expect(assets).not.toContain('SESSION_SECRET=')
    expect(assets).not.toContain('Bearer server-token')
    expect(assets).not.toContain('Authorization:')
    expect(assets).not.toContain('public-app-id')
    expect(assets).not.toContain('access_token')
    expect(assets).not.toContain('refresh_token')
    expect(assets).not.toContain('oauth code')
    expect(assets).not.toContain('encrypted_access_token')
    expect(assets).not.toContain('result_json')
  })
})
