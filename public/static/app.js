const $ = (selector) => document.querySelector(selector)
const page = document.body.dataset.page
const configurationAlert = $('#configuration-alert')
const workspace = $('#workspace')
const ONBOARDING_KEY = 'threads-tools:personal-setup-complete'

const errorMessages = {
  OAUTH_CANCELLED: 'Threads authorization was cancelled. Your existing connection was not changed.',
  OAUTH_STATE_INVALID: 'The connection request expired or could not be verified. Please start again.',
  AUTHORIZATION_FAILED: 'Threads did not authorize the connection. Check the app and permission setup.',
  TOKEN_EXCHANGE_FAILED: 'Authorization succeeded, but secure token exchange failed. Please try again.',
  ACCOUNT_LOOKUP_FAILED: 'Authorization succeeded, but the account identity could not be verified.',
  AUTHORIZATION_EXPIRED: 'Threads authorization expired. Reconnect the account to continue.',
  CAPABILITY_NOT_GRANTED: 'Publishing permission is missing. Reconnect Threads and approve content publishing.',
  VALIDATION_FAILED: 'Review the post text and try again.',
  RATE_LIMITED: 'Threads publishing limits were reached. Wait before trying again.',
  PROVIDER_UNAVAILABLE: 'Threads is temporarily unavailable. No automatic retry was made.',
  CONTAINER_CREATION_FAILED: 'Threads could not prepare the post. No automatic publish retry was made.',
  PUBLISH_FAILED: 'Threads rejected the publish operation.',
  PUBLISH_RESULT_UNCERTAIN: 'The publish result is uncertain. Check Posts before publishing again.',
  DUPLICATE_IN_PROGRESS: 'This publish request is already processing. Check Posts before trying again.',
  DUPLICATE_REQUEST: 'This publish request has already been used. Review Posts before starting again.',
  CONFIGURATION_MISSING: 'Server configuration is incomplete.',
  INTERNAL_ERROR: 'An unexpected error occurred. Please try again.',
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Request failed')
    error.code = data.error?.code
    error.status = response.status
    error.reauthorizationRequired = data.error?.reauthorizationRequired
    error.retryable = data.error?.retryable
    error.steps = data.error?.steps
    error.providerStatus = data.error?.providerStatus
    error.providerCode = data.error?.providerCode
    error.diagnostic = data.error?.diagnostic
    throw error
  }
  return data
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function safeUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch { return undefined }
}

function formatDate(value) {
  if (!value) return 'Timestamp unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Timestamp unavailable' : date.toLocaleString()
}

function showConfiguration(data) {
  if (data.status !== 'not_configured') return
  configurationAlert.classList.remove('hidden')
  configurationAlert.innerHTML = `<strong>Configuration required</strong><p>The server is missing: ${data.missing.map(escapeHtml).join(', ')}. Add these values as server secrets before connecting Threads.</p>`
}

function setupWasCompleted() {
  try { return localStorage.getItem(ONBOARDING_KEY) === 'true' }
  catch { return true }
}

function completeSetup() {
  try { localStorage.setItem(ONBOARDING_KEY, 'true') } catch { /* storage is optional */ }
  location.assign('/')
}

function recoveryState(error) {
  const reconnect = error.code === 'AUTHORIZATION_EXPIRED' || error.reauthorizationRequired
    ? '<a class="button primary" href="/auth/threads/start">Reconnect Threads</a>'
    : error.code === 'NOT_CONNECTED'
      ? '<a class="button primary" href="/settings">Connect Threads</a>'
      : ''
  return `<div class="empty-state error-state"><h3>${escapeHtml(error.code === 'NOT_CONNECTED' ? 'Not connected' : 'Unable to load data')}</h3><p>${escapeHtml(error.message)}</p>${reconnect}</div>`
}

function capabilityState(title, message, status = 'unsupported') {
  return `<div class="empty-state capability-state"><span class="badge ${status === 'error' ? 'danger' : 'neutral'}">${escapeHtml(status.replace('_', ' '))}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`
}

function showResultNotice(container) {
  const params = new URLSearchParams(location.search)
  const result = params.get('result')
  if (!result) return
  const notice = document.createElement('div')
  notice.className = `alert ${result === 'connected' ? 'success' : 'error'}`
  notice.setAttribute('role', 'status')
  notice.textContent = result === 'connected' ? 'Threads account connected successfully with the requested read permissions.' : (errorMessages[params.get('code')] || 'The connection could not be completed safely.')
  container.prepend(notice)
  history.replaceState({}, '', location.pathname)
}

function mediaMarkup(item) {
  const source = safeUrl(item.thumbnailUrl || item.mediaUrl || item.gifUrl)
  if (!source) return ''
  return `<img class="post-media" src="${escapeHtml(source)}" alt="${escapeHtml(item.altText || 'Threads post media')}" loading="lazy">`
}

function postCard(post, options = {}) {
  const permalink = safeUrl(post.permalink)
  const text = post.text ? escapeHtml(post.text) : '<span class="muted-text">No text returned for this media post.</span>'
  const select = options.select ? `<button class="button secondary select-post" data-post-id="${escapeHtml(post.id)}" type="button">View replies</button>` : ''
  return `<article class="post-card" data-id="${escapeHtml(post.id)}">${mediaMarkup(post)}<div class="post-body"><div class="post-meta"><span>${escapeHtml(formatDate(post.timestamp))}</span><span>${escapeHtml(post.mediaType || 'Media type unavailable')}</span></div><p class="post-text">${text}</p><div class="post-tags">${post.topicTag ? `<span class="badge neutral">${escapeHtml(post.topicTag)}</span>` : ''}${post.isQuotePost ? '<span class="badge neutral">Quote</span>' : ''}</div><div class="post-actions"><a class="text-link" href="/posts/${encodeURIComponent(post.id)}">Open details</a><a class="text-link" href="/engagement?post=${encodeURIComponent(post.id)}">Engagement</a>${permalink ? `<a class="text-link" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">Open on Threads</a>` : '<span class="muted-text">Permalink unavailable</span>'}${select}</div></div></article>`
}

function replyCard(reply) {
  const permalink = safeUrl(reply.permalink)
  return `<article class="reply-card"><div class="reply-author">${reply.profilePictureUrl && safeUrl(reply.profilePictureUrl) ? `<img src="${escapeHtml(safeUrl(reply.profilePictureUrl))}" alt="" loading="lazy">` : '<span class="account-avatar small" aria-hidden="true">T</span>'}<div><strong>${escapeHtml(reply.username ? '@' + reply.username : 'Author unavailable')}</strong>${reply.isVerified ? '<span class="verified" title="Verified">✓</span>' : ''}<p>${escapeHtml(formatDate(reply.timestamp))}</p></div></div><p>${reply.text ? escapeHtml(reply.text) : '<span class="muted-text">No text returned.</span>'}</p><div class="post-actions">${reply.hasReplies ? '<span class="badge neutral">Has nested replies</span>' : ''}${permalink ? `<a class="text-link" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">Open reply</a>` : ''}</div></article>`
}

function metricValue(metric) {
  if (typeof metric.total === 'number') return metric.total
  if (Array.isArray(metric.values) && metric.values.length) return metric.values.reduce((sum, item) => sum + item.value, 0)
  if (Array.isArray(metric.linkValues) && metric.linkValues.length) return metric.linkValues.reduce((sum, item) => sum + item.value, 0)
  return undefined
}

function metricCards(metrics) {
  if (!metrics?.length) return capabilityState('No metrics returned', 'Threads completed the request but returned no metrics.', 'empty')
  return metrics.map((metric) => {
    const value = metricValue(metric)
    return `<article class="metric-card"><p>${escapeHtml(metric.title || metric.name)}</p><strong>${typeof value === 'number' ? value.toLocaleString() : 'Unavailable'}</strong><small>${escapeHtml(metric.period ? `Period: ${metric.period}` : 'Time context unavailable')}</small></article>`
  }).join('')
}

function renderConnection(connection) {
  $('#connection-loading').classList.add('hidden')
  const content = $('#connection-content')
  const badge = $('#status-badge')
  content.classList.remove('hidden')
  badge.className = 'badge'
  if (connection.status === 'connected') {
    badge.classList.add('supported'); badge.textContent = 'Connected'
    content.innerHTML = `<div class="account-card"><div class="account-avatar" aria-hidden="true">${escapeHtml((connection.displayName || connection.username || 'T')[0].toUpperCase())}</div><div><h3>${escapeHtml(connection.displayName || connection.username || 'Threads account')}</h3><p>${connection.username ? '@' + escapeHtml(connection.username) : 'Account ID ' + escapeHtml(connection.accountId)}</p></div></div><dl class="details"><div><dt>Account ID</dt><dd>${escapeHtml(connection.accountId)}</dd></div><div><dt>Connected</dt><dd>${escapeHtml(formatDate(connection.connectedAt))}</dd></div>${connection.tokenExpiresAt ? `<div><dt>Authorization expires</dt><dd>${escapeHtml(formatDate(connection.tokenExpiresAt))}</dd></div>` : ''}</dl><div class="permission-note"><strong>Phase 3 permissions requested</strong><p><code>threads_basic</code>, <code>threads_content_publish</code>, <code>threads_read_replies</code>, and <code>threads_manage_insights</code>. Existing connections must reconnect; availability still depends on app roles/review and the account grant.</p></div><div class="actions"><a class="button secondary" href="/auth/threads/start">Reconnect Threads</a><button id="disconnect" class="button danger" type="button">Disconnect</button></div>`
    $('#disconnect').addEventListener('click', disconnect)
  } else {
    badge.classList.add('neutral'); badge.textContent = 'Disconnected'
    content.innerHTML = `<div class="empty-state"><h3>No Threads account connected</h3><p>Authorize the app to publish text posts, read owned posts, and request supported reply and insights permissions.</p><a class="button primary" href="/auth/threads/start">Connect Threads</a></div>`
  }
}

async function disconnect() {
  if (!confirm('Disconnect this Threads account? The stored encrypted credential will be deleted.')) return
  const button = $('#disconnect'); button.disabled = true; button.textContent = 'Disconnecting…'
  try { renderConnection(await request('/api/connection/disconnect', { method: 'POST' })) }
  catch (error) { alert(error.message); button.disabled = false; button.textContent = 'Disconnect' }
}

async function loadSettings() {
  try { renderConnection(await request('/api/connection/status')); showResultNotice(workspace) }
  catch (error) {
    $('#connection-loading').classList.add('hidden')
    $('#connection-content').classList.remove('hidden')
    $('#connection-content').innerHTML = recoveryState(error)
  }
}

function readinessRow(label, status, action) {
  const configured = status === 'configured'
  return `<div class="readiness-row"><div><strong>${escapeHtml(label)}</strong><small>${configured ? 'Production binding detected.' : escapeHtml(action)}</small></div><span class="badge ${configured ? 'supported' : 'warning'}">${configured ? 'Configured' : 'Missing'}</span></div>`
}

async function copySafeValue(value, button) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    const previous = button.textContent
    button.textContent = 'Copied'
    setTimeout(() => { button.textContent = previous }, 1400)
  } catch {
    button.textContent = 'Copy failed'
  }
}

async function legacyLoadSetup() {
  const configBadge = $('#setup-config-badge')
  const readiness = $('#setup-readiness')
  const bridgeBadge = $('#setup-bridge-badge')
  const bridgeNode = $('#setup-bridge')
  const connectionBadge = $('#setup-connection-badge')
  const connectionNode = $('#setup-connection')
  const recheckButton = $('#recheck-configuration')
  if (recheckButton) { recheckButton.disabled = true; recheckButton.textContent = 'Checking…' }
  const [configuration, connection] = await Promise.allSettled([
    request('/api/configuration'), request('/api/connection/status'),
  ])

  let configurationReady = false
  if (configuration.status === 'fulfilled') {
    const data = configuration.value
    configurationReady = data.status === 'supported'
    configBadge.className = `badge ${configurationReady ? 'supported' : 'warning'}`
    configBadge.textContent = configurationReady ? 'Ready' : 'Action needed'
    readiness.innerHTML = [
      ['Threads App ID', data.readiness.threadsAppId, 'Add the App ID binding as a Production Variable.'],
      ['Threads App Secret', data.readiness.threadsAppSecret, 'Add the App Secret binding as an encrypted Production Secret.'],
      ['Redirect URI', data.readiness.redirectUri, 'Add the redirect binding as a Production Variable, then register the same URI with Meta.'],
      ['API Base URL', data.readiness.apiBaseUrl, 'The secure default is active; an explicit Production Variable is optional.'],
      ['Session/token encryption secret', data.readiness.sessionSecret, 'Add a 32+ character random value as an encrypted Production Secret.'],
    ].map(([label, status, action]) => readinessRow(label, status, action)).join('')
    bridgeBadge.className = 'badge warning'
    bridgeBadge.textContent = 'Manual setup required'
    bridgeNode.innerHTML = `<div class="bridge-state"><h3>Automated writes are safely disabled</h3><p>${escapeHtml(data.bridge.reason)}</p><p>Use the explicit owner-only checklist below. This application never accepts a raw Cloudflare API token in the browser.</p></div>`
    const redirectSuggestion = data.actions?.redirectUriSuggestion
    $('#redirect-uri-suggestion').textContent = redirectSuggestion || 'Unavailable'
    $('#copy-redirect-uri').dataset.copyValue = redirectSuggestion || ''
    $('#open-cloudflare').href = safeUrl(data.actions?.cloudflareDashboardUrl) || 'https://dash.cloudflare.com/'
  } else {
    configBadge.className = 'badge danger'; configBadge.textContent = 'Error'
    readiness.innerHTML = recoveryState(configuration.reason)
    bridgeBadge.className = 'badge danger'; bridgeBadge.textContent = 'Check failed'
    bridgeNode.innerHTML = capabilityState('Configuration status unavailable', 'No configuration write was attempted.', 'error')
  }
  if (recheckButton) { recheckButton.disabled = false; recheckButton.textContent = 'Re-check Configuration' }

  if (connection.status === 'rejected') {
    connectionBadge.className = 'badge danger'; connectionBadge.textContent = 'Error'
    connectionNode.innerHTML = recoveryState(connection.reason)
    return
  }

  const value = connection.value
  if (value.status !== 'connected') {
    connectionBadge.className = 'badge neutral'; connectionBadge.textContent = 'Disconnected'
    connectionNode.innerHTML = configurationReady
      ? '<div class="empty-state"><h3>Connect the owner’s Threads account</h3><p>The existing server-side OAuth flow will validate state and store the resulting token encrypted in D1.</p><a class="button primary" href="/auth/threads/start">Connect Threads</a></div>'
      : '<div class="empty-state"><h3>Finish Production configuration first</h3><p>Follow the Cloudflare checklist above, save the bindings, then select Re-check Configuration.</p><a class="text-link" href="#manual-setup">Open configuration checklist</a></div>'
    showResultNotice(connectionNode)
    return
  }

  const expired = value.tokenExpiresAt && new Date(value.tokenExpiresAt).getTime() <= Date.now()
  connectionBadge.className = `badge ${expired ? 'warning' : 'supported'}`
  connectionBadge.textContent = expired ? 'Reconnect required' : 'Connected'
  const identity = value.username ? `@${escapeHtml(value.username)}` : escapeHtml(value.displayName || `Account ${value.accountId}`)
  connectionNode.innerHTML = expired
    ? `<div class="empty-state"><h3>Threads authorization needs attention</h3><p>${identity} is stored, but its authorization has expired. Reconnect securely to continue.</p>${configurationReady ? '<a class="button primary" href="/auth/threads/start">Reconnect Threads</a>' : ''}</div>`
    : `<div class="setup-success"><h3>${identity} is connected</h3><p>Personal setup is ready. Continue into the existing operator dashboard.</p><div class="actions"><button id="continue-dashboard" class="button primary" type="button">Continue to Dashboard</button><a class="button secondary" href="/auth/threads/start">Reconnect Threads</a></div></div>`
  $('#continue-dashboard')?.addEventListener('click', completeSetup)
  showResultNotice(connectionNode)
}

function bridgeErrorMessage(code) {
  return ({
    OWNER_AUTHORIZATION_REQUIRED: 'Cloudflare Access did not confirm the configured owner.',
    OWNER_AUTHORIZATION_NOT_CONFIGURED: 'Configure the signed Cloudflare Access owner boundary first.',
    CLOUDFLARE_OAUTH_NOT_CONFIGURED: 'Create the private Cloudflare OAuth client and add its server-side bindings.',
    CLOUDFLARE_STATE_INVALID: 'The Cloudflare authorization request expired or was already used. Start again.',
    CLOUDFLARE_CODE_INVALID: 'Cloudflare did not return a usable authorization code.',
    CLOUDFLARE_TOKEN_EXCHANGE_FAILED: 'Cloudflare authorization succeeded, but secure token exchange failed.',
    CLOUDFLARE_AUTHORIZATION_EXPIRED: 'Cloudflare authorization expired. Connect Cloudflare again.',
  })[code] || 'The Cloudflare connection could not be completed safely.'
}

function renderProjectOptions(resources, selectedAccount, selectedProject) {
  const options = resources.accounts.flatMap((account) => account.projects.map((project) => ({ account, project })))
  const select = $('#project-select')
  select.innerHTML = options.map(({ account, project }) => {
    const value = `${account.id}:${project.name}`
    const selected = account.id === selectedAccount && project.name === selectedProject ? ' selected' : ''
    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(account.name)} — ${escapeHtml(project.name)}</option>`
  }).join('')
  return options
}

async function loadCloudflareConnection(configuration) {
  const badge = $('#setup-bridge-badge')
  const node = $('#setup-bridge')
  const projectSection = $('#project-section')
  const automaticSection = $('#automatic-configuration')
  if (!configuration.bridge.automatedWritesAvailable) {
    const ownerBoundaryMissing = configuration.bridge.status === 'owner_boundary_required'
    badge.className = 'badge warning'; badge.textContent = 'Bootstrap required'
    node.innerHTML = ownerBoundaryMissing
      ? `<div class="bridge-state"><h3>Cloudflare Access: Not configured</h3><p>${escapeHtml(configuration.bridge.reason)}</p><p>Enable Access for the production hostname, allow only the owner email, then add <code>CF_ACCESS_TEAM_DOMAIN</code>, <code>CF_ACCESS_AUD</code>, and <code>OWNER_EMAIL</code> as Production Variables.</p></div>`
      : `<div class="bridge-state"><h3>Cloudflare OAuth client: Not configured</h3><p>${escapeHtml(configuration.bridge.reason)}</p><p>Create a private client with Authorization Code, <code>client_secret_basic</code>, the exact callback below, and the minimum Pages read/write capabilities.</p></div>`
    projectSection.classList.add('hidden'); automaticSection.classList.add('hidden')
    return undefined
  }
  try {
    const status = await request('/api/cloudflare/status')
    if (status.status === 'not_connected' || status.status === 'expired') {
      badge.className = `badge ${status.status === 'expired' ? 'warning' : 'neutral'}`
      badge.textContent = status.status === 'expired' ? 'Expired' : 'Not connected'
      node.innerHTML = `<div class="empty-state"><h3>${status.status === 'expired' ? 'Reconnect Cloudflare' : 'Connect Cloudflare'}</h3><p>Authorize this private owner tool using Cloudflare’s official consent flow.</p><a class="button primary" href="/auth/cloudflare/start">${status.status === 'expired' ? 'Reconnect Cloudflare' : 'Connect Cloudflare'}</a></div>`
      projectSection.classList.add('hidden'); automaticSection.classList.add('hidden')
      return status
    }
    badge.className = 'badge supported'; badge.textContent = 'Connected'
    node.innerHTML = `<div class="connected-strip"><span class="badge supported">Connected</span><div><strong>${escapeHtml(status.accountName || 'Authorized Cloudflare principal')}</strong><p>${status.projectName ? `Pages project: ${escapeHtml(status.projectName)}` : 'Choose an authorized Pages project below.'}</p></div><a class="button secondary" href="/auth/cloudflare/start">Reconnect</a></div>`
    const resources = await request('/api/cloudflare/resources')
    const options = renderProjectOptions(resources, status.accountId, status.projectName)
    projectSection.classList.remove('hidden')
    if (status.projectName) automaticSection.classList.remove('hidden')
    else automaticSection.classList.add('hidden')
    if (!options.length) node.insertAdjacentHTML('beforeend', capabilityState('No Pages projects available', 'The authorization returned no Pages project visible with the granted scopes.', 'empty'))
    return status
  } catch (error) {
    badge.className = 'badge danger'; badge.textContent = 'Owner check required'
    node.innerHTML = capabilityState('Cloudflare connection unavailable', error.message, 'error')
    projectSection.classList.add('hidden'); automaticSection.classList.add('hidden')
    return undefined
  }
}

const sparkpodErrorMessages = {
  SPARKPOD_SECRET_MISSING: ['Secret missing', 'Add DAYTONA_API_KEY as a Cloudflare Production Secret, redeploy, then re-check.'],
  SPARKPOD_AUTHENTICATION_FAILED: ['Authentication failed', 'Daytona rejected the configured credential. Verify the Production Secret in Cloudflare.'],
  SPARKPOD_SANDBOX_CREATION_FAILED: ['Sandbox creation failed', 'Daytona connected, but could not create the isolated test sandbox.'],
  SPARKPOD_SANDBOX_READINESS_FAILED: ['Sandbox readiness failed', 'The sandbox was created but did not become ready before the bounded check completed. Cleanup was still attempted.'],
  SPARKPOD_COMMAND_EXECUTION_FAILED: ['Command execution failed', 'The sandbox became ready, but the deterministic command could not be executed.'],
  SPARKPOD_OUTPUT_VERIFICATION_FAILED: ['Output verification failed', 'The command completed, but its server-side deterministic result did not match the expected proof.'],
  SPARKPOD_CLEANUP_FAILED: ['Cleanup failed', 'The test ran, but the sandbox could not be deleted. Auto-delete remains enabled.'],
  SPARKPOD_DAYTONA_TIMEOUT: ['Provider timeout', 'The Daytona request exceeded the bounded connection-test timeout.'],
  SPARKPOD_DAYTONA_NETWORK_FAILED: ['Provider network failure', 'Cloudflare could not complete the network request to Daytona.'],
}

function sparkpodSteps(steps = {}) {
  const items = [
    ['sandboxCreated', 'Sandbox created'],
    ['sandboxReady', 'Sandbox ready'],
    ['commandExecuted', 'Command executed successfully'],
    ['outputVerified', 'Output verified server-side'],
    ['sandboxCleanedUp', 'Sandbox cleaned up'],
  ]
  return `<ol class="sparkpod-steps">${items.map(([key, label]) => {
    const value = steps[key]
    const status = value === true || value === 'completed' ? 'completed' : value === false || value === 'failed' ? 'failed' : 'not_started'
    const symbol = status === 'completed' ? '✓' : status === 'failed' ? '×' : '–'
    return `<li class="${escapeHtml(status)}"><span aria-hidden="true">${symbol}</span>${escapeHtml(label)}</li>`
  }).join('')}</ol>`
}

async function loadSparkPod() {
  const badge = $('#sparkpod-status-badge')
  const statusText = $('#sparkpod-status-text')
  const button = $('#test-sparkpod')
  const result = $('#sparkpod-test-result')
  if (!badge || !statusText || !button) return
  badge.className = 'badge neutral'; badge.textContent = 'Checking'
  statusText.textContent = 'Checking configuration…'; button.disabled = true
  try {
    const status = await request('/api/sparkpod/daytona/status')
    badge.className = `badge ${status.configured ? 'supported' : 'warning'}`
    badge.textContent = status.configured ? 'Configured' : 'Not configured'
    statusText.textContent = status.configured ? 'Configured' : 'Not configured'
    button.disabled = !status.configured
    if (!status.configured) {
      result.classList.remove('hidden')
      result.innerHTML = '<div class="alert warning"><strong>Secret missing</strong><p>Add <code>DAYTONA_API_KEY</code> as a Cloudflare Production Secret, then redeploy. Credentials are never entered or stored here.</p></div>'
    } else if (!result.dataset.tested) result.classList.add('hidden')
  } catch (error) {
    badge.className = 'badge danger'; badge.textContent = 'Status unavailable'
    statusText.textContent = 'Owner verification required'
    result.classList.remove('hidden')
    result.innerHTML = `<div class="alert error"><strong>Unable to verify SparkPod</strong><p>${escapeHtml(error.message)}</p></div>`
  }
}

async function testSparkPod() {
  const button = $('#test-sparkpod')
  const result = $('#sparkpod-test-result')
  button.disabled = true; button.textContent = 'Testing…'; button.setAttribute('aria-busy', 'true')
  result.dataset.tested = 'true'; result.classList.remove('hidden')
  result.innerHTML = `<div class="sparkpod-running"><strong>Testing the remote execution foundation…</strong>${sparkpodSteps()}</div>`
  try {
    const response = await request('/api/sparkpod/daytona/test', { method: 'POST' })
    result.innerHTML = `<div class="alert success"><strong>✓ Daytona connected</strong><p>Cloudflare Secret → Daytona → Sandbox → Readiness → Execute → Verify → Cleanup completed successfully.</p></div>${sparkpodSteps(response)}`
  } catch (error) {
    const [title, guidance] = sparkpodErrorMessages[error.code] || ['Connection test failed', error.message || 'SparkPod could not complete the verification flow.']
    const providerDetails = [
      Number.isInteger(error.providerStatus) ? `HTTP ${error.providerStatus}` : '',
      error.providerCode ? `Code: ${error.providerCode}` : '',
      error.diagnostic || '',
    ].filter(Boolean).map(escapeHtml).join(' — ')
    result.innerHTML = `<div class="alert error"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(guidance)}</p>${providerDetails ? `<p><strong>Safe Daytona diagnostic:</strong> ${providerDetails}</p>` : ''}<p><strong>Retryable:</strong> ${error.retryable ? 'Yes' : 'No'}</p></div>${sparkpodSteps(error.steps)}`
  } finally {
    button.textContent = 'Test Connection'; button.removeAttribute('aria-busy')
    await loadSparkPod()
  }
}

async function loadSetup() {
  void loadSparkPod()
  const configBadge = $('#setup-config-badge')
  const readiness = $('#setup-readiness')
  const connectionBadge = $('#setup-connection-badge')
  const connectionNode = $('#setup-connection')
  const recheck = $('#recheck-configuration')
  recheck.disabled = true; recheck.textContent = 'Checking…'
  try {
    const configuration = await request('/api/configuration')
    const runtimeReady = configuration.status === 'supported'
    configBadge.className = `badge ${runtimeReady ? 'supported' : 'warning'}`
    configBadge.textContent = runtimeReady ? 'Runtime ready' : 'Action needed'
    readiness.innerHTML = [
      ['Threads App ID', configuration.readiness.threadsAppId, 'Apply as a Production Variable.'],
      ['Threads App Secret', configuration.readiness.threadsAppSecret, 'Apply as an encrypted Production Secret.'],
      ['Redirect URI', configuration.readiness.redirectUri, 'Apply the exact deployment callback URI.'],
      ['API Base URL', configuration.readiness.apiBaseUrl, 'Secure official default is active.'],
      ['Session/token encryption secret', configuration.readiness.sessionSecret, 'Bootstrap as a 32+ character encrypted Production Secret.'],
    ].map(([label, status, action]) => readinessRow(label, status, action)).join('')
    $('#cloudflare-callback-url').textContent = configuration.bridge.callbackUrl
    $('#redirect-uri-suggestion').textContent = configuration.actions.redirectUriSuggestion
    $('#copy-redirect-uri').dataset.copyValue = configuration.actions.redirectUriSuggestion
    $('#open-cloudflare-access').href = safeUrl(configuration.actions.accessDashboardUrl) || 'https://one.dash.cloudflare.com/'
    $('#open-oauth-clients').href = safeUrl(configuration.actions.oauthClientsDashboardUrl) || 'https://dash.cloudflare.com/'
    $('#open-cloudflare').href = safeUrl(configuration.actions.cloudflareDashboardUrl) || 'https://dash.cloudflare.com/'
    const ownerBoundaryStep = configuration.bridge.status === 'owner_boundary_required'
      ? '<li>Enable Cloudflare Access for the production custom hostname and allow only the exact owner email.</li><li>Copy the team domain and Application Audience (AUD) tag into the three owner Production Variables.</li>'
      : ''
    $('#manual-bootstrap').innerHTML = `<p>${escapeHtml(configuration.bridge.reason)}</p><ul>${ownerBoundaryStep}<li>Private OAuth client</li><li>Grant: <code>${escapeHtml(configuration.bridge.grantType)}</code></li><li>Token authentication: <code>${escapeHtml(configuration.bridge.tokenAuthenticationMethod)}</code></li><li>${escapeHtml(configuration.bridge.minimumScopeGuidance)}</li><li>Server bindings: ${configuration.bridge.requiredServerBindings.map((name) => `<code>${escapeHtml(name)}</code>`).join(', ')}</li></ul>`
    await loadCloudflareConnection(configuration)

    const connection = await request('/api/connection/status')
    if (connection.status === 'connected') {
      connectionBadge.className = 'badge supported'; connectionBadge.textContent = 'Connected'
      connectionNode.innerHTML = `<div class="setup-success"><h3>${escapeHtml(connection.username ? '@' + connection.username : connection.displayName || 'Threads account')} is connected</h3><div class="actions"><button id="continue-dashboard" class="button primary" type="button">Continue to Dashboard</button><a class="button secondary" href="/auth/threads/start">Reconnect Threads</a></div></div>`
      $('#continue-dashboard')?.addEventListener('click', completeSetup)
    } else {
      connectionBadge.className = 'badge neutral'; connectionBadge.textContent = 'Disconnected'
      connectionNode.innerHTML = runtimeReady
        ? '<div class="empty-state"><h3>Connect the owner’s Threads account</h3><p>Production runtime configuration is ready.</p><a class="button primary" href="/auth/threads/start">Connect Threads</a></div>'
        : '<div class="empty-state"><h3>Production runtime is not ready</h3><p>Apply configuration, redeploy Pages, then re-check before connecting Threads.</p></div>'
    }
    const params = new URLSearchParams(location.search)
    if (params.get('cloudflare')) {
      const notice = document.createElement('div')
      notice.className = `alert ${params.get('cloudflare') === 'connected' ? 'success' : 'error'}`
      notice.textContent = params.get('cloudflare') === 'connected' ? 'Cloudflare connected. Confirm the intended account and Pages project.' : bridgeErrorMessage(params.get('code'))
      workspace.prepend(notice); history.replaceState({}, '', location.pathname)
    } else showResultNotice(connectionNode)
  } catch (error) {
    configBadge.className = 'badge danger'; configBadge.textContent = 'Error'
    readiness.innerHTML = recoveryState(error)
  } finally {
    recheck.disabled = false; recheck.textContent = 'Re-check Configuration'
  }
}

async function selectCloudflareProject(event) {
  event.preventDefault()
  const [accountId, ...projectParts] = $('#project-select').value.split(':')
  const projectName = projectParts.join(':')
  const button = event.currentTarget.querySelector('button[type="submit"]')
  button.disabled = true; button.textContent = 'Confirming…'
  try {
    await request('/api/cloudflare/project', { method: 'POST', headers: { Origin: location.origin }, body: JSON.stringify({ accountId, projectName }) })
    await loadSetup()
  } catch (error) { alert(error.message) }
  finally { button.disabled = false; button.textContent = 'Confirm project' }
}

async function applyProductionConfiguration(event) {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button[type="submit"]')
  const result = $('#configuration-result')
  button.disabled = true; button.textContent = 'Applying…'; result.textContent = ''
  try {
    const payload = { THREADS_APP_ID: $('#threads-app-id').value, THREADS_APP_SECRET: $('#threads-app-secret').value }
    const status = await request('/api/configuration/apply', { method: 'POST', headers: { Origin: location.origin }, body: JSON.stringify(payload) })
    $('#threads-app-secret').value = ''
    result.innerHTML = `<div class="alert success"><strong>Production configuration verified</strong><p>${escapeHtml(status.message)}</p></div>`
    await loadSetup()
  } catch (error) {
    $('#threads-app-secret').value = ''
    result.innerHTML = `<div class="alert error"><strong>Configuration was not applied</strong><p>${escapeHtml(error.message)}</p></div>`
  } finally { button.disabled = false; button.textContent = 'Apply Production' }
}

async function disconnectCloudflare() {
  if (!confirm('Disconnect Cloudflare and delete the encrypted OAuth credential?')) return
  try { await request('/api/cloudflare/disconnect', { method: 'POST', headers: { Origin: location.origin } }); await loadSetup() }
  catch (error) { alert(error.message) }
}

async function loadDashboard() {
  const healthNode = $('#dashboard-health'); const accountNode = $('#dashboard-account'); const postsNode = $('#dashboard-posts')
  const engagementNode = $('#dashboard-engagement'); const insightsNode = $('#dashboard-insights')
  const [connection, account, posts, insights] = await Promise.allSettled([
    request('/api/connection/status'), request('/api/read/account'), request('/api/read/posts?limit=4'), request('/api/read/insights/account'),
  ])
  if (connection.status === 'fulfilled') {
    const value = connection.value
    if (value.status === 'connected') {
      const expires = value.tokenExpiresAt ? new Date(value.tokenExpiresAt) : undefined
      const expiring = expires && expires.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000
      healthNode.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Account & configuration health</p><h2>${expiring ? 'Reauthorization recommended' : 'Connection healthy'}</h2></div><span class="badge ${expiring ? 'warning' : 'supported'}">${expiring ? 'Action needed' : 'Connected'}</span></div><p>${expiring ? 'The stored authorization is expired or expires within seven days. Reconnect before daily operations are interrupted.' : 'Server configuration is available and the account connection is active.'}</p>${expiring ? '<a class="button primary" href="/auth/threads/start">Reconnect Threads</a>' : '<a class="text-link" href="/settings">Review connection</a>'}`
    } else healthNode.innerHTML = capabilityState('Threads is not connected', 'Open Connection & Settings to authorize the operator account.', 'not_configured')
  } else healthNode.innerHTML = recoveryState(connection.reason)
  if (account.status === 'fulfilled') {
    const item = account.value.data
    accountNode.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Connected account</p><h2>${escapeHtml(item.name || item.username || 'Threads account')}</h2></div><span class="badge supported">Live data</span></div><div class="account-card">${item.profilePictureUrl && safeUrl(item.profilePictureUrl) ? `<img class="account-avatar image" src="${escapeHtml(safeUrl(item.profilePictureUrl))}" alt="">` : `<div class="account-avatar">${escapeHtml((item.name || item.username || 'T')[0])}</div>`}<div><strong>${item.username ? '@' + escapeHtml(item.username) : escapeHtml(item.id)}</strong><p>${escapeHtml(item.biography || 'Biography unavailable')}</p></div></div>`
  } else accountNode.innerHTML = recoveryState(account.reason)
  if (posts.status === 'fulfilled') {
    postsNode.innerHTML = posts.value.items.length ? posts.value.items.map((item) => postCard(item)).join('') : capabilityState('No posts yet', 'Threads returned a valid empty post list.', 'empty')
    const first = posts.value.items[0]
    if (first) {
      try {
        const replies = await request(`/api/read/posts/${encodeURIComponent(first.id)}/replies?limit=10`)
        if (['unsupported', 'error', 'reauthorization_required'].includes(replies.status)) engagementNode.innerHTML = capabilityState('Replies unavailable', replies.message, replies.status)
        else engagementNode.innerHTML = `<p class="eyebrow">Latest-post engagement</p><h2>${replies.data.items.length.toLocaleString()}</h2><p>Top-level ${replies.data.items.length === 1 ? 'reply' : 'replies'} returned for the latest post.</p><a class="text-link" href="/engagement?post=${encodeURIComponent(first.id)}">Open engagement</a>`
      } catch (error) { engagementNode.innerHTML = recoveryState(error) }
    } else engagementNode.innerHTML = capabilityState('No engagement to inspect', 'Publish activity is required before replies can be read.', 'empty')
  } else {
    postsNode.innerHTML = recoveryState(posts.reason)
    engagementNode.innerHTML = capabilityState('Engagement unavailable', 'Posts could not be loaded.', 'error')
  }
  if (insights.status === 'fulfilled') {
    const data = insights.value
    if (data.status === 'supported') insightsNode.innerHTML = `<p class="eyebrow">Account insights</p><div class="mini-metrics">${data.data.slice(0, 3).map((metric) => `<div><strong>${typeof metricValue(metric) === 'number' ? metricValue(metric).toLocaleString() : 'Unavailable'}</strong><span>${escapeHtml(metric.title || metric.name)}</span></div>`).join('')}</div><a class="text-link" href="/insights">View insights</a>`
    else insightsNode.innerHTML = capabilityState('Insights unavailable', data.message || 'No account metrics were returned.', data.status)
  } else insightsNode.innerHTML = recoveryState(insights.reason)
}

let postsCursor
let loadedPosts = []
function renderLoadedPosts() {
  const search = ($('#posts-search')?.value || '').trim().toLocaleLowerCase()
  const sort = $('#posts-sort')?.value || 'newest'
  const filtered = loadedPosts.filter((item) => !search || (item.text || '').toLocaleLowerCase().includes(search))
    .sort((a, b) => {
      const left = a.timestamp ? new Date(a.timestamp).getTime() : 0
      const right = b.timestamp ? new Date(b.timestamp).getTime() : 0
      return sort === 'oldest' ? left - right : right - left
    })
  $('#posts-list').innerHTML = filtered.length ? filtered.map((item) => postCard(item)).join('') : capabilityState(search ? 'No loaded posts match' : 'No posts found', search ? 'Change the search or load another bounded provider page.' : 'Threads returned a valid empty dataset.', 'empty')
  $('#posts-count').textContent = `${filtered.length} of ${loadedPosts.length} loaded`
  $('#posts-filter-note').textContent = search ? `Filtering ${loadedPosts.length} loaded posts locally. Provider pages not yet loaded are not searched.` : `${loadedPosts.length} posts loaded from bounded provider pages.`
}
async function loadPosts(append = false) {
  const list = $('#posts-list'); const button = $('#load-more-posts')
  if (!append) { list.innerHTML = '<div class="skeleton-lines"><span></span><span></span></div>'; loadedPosts = []; postsCursor = undefined }
  button.disabled = true
  try {
    const query = postsCursor ? `?after=${encodeURIComponent(postsCursor)}&limit=12` : '?limit=12'
    const result = await request('/api/read/posts' + query)
    loadedPosts.push(...result.items.filter((item) => !loadedPosts.some((existing) => existing.id === item.id)))
    postsCursor = result.nextCursor
    renderLoadedPosts()
    button.classList.toggle('hidden', !postsCursor)
  } catch (error) { if (!append) list.innerHTML = recoveryState(error) }
  finally { button.disabled = false; button.textContent = 'Load more' }
}

let selectedPostId
let repliesCursor
let engagementPosts = []
async function loadReplies(postId, append = false) {
  selectedPostId = postId
  if (!append) repliesCursor = undefined
  const selected = engagementPosts.find((item) => item.id === postId)
  const context = $('#selected-post-context')
  if (context && selected) context.innerHTML = `<p class="eyebrow">Selected post</p><h3>${escapeHtml(selected.text || `${selected.mediaType || 'Media'} post`)}</h3><p>${escapeHtml(formatDate(selected.timestamp))}</p><a class="text-link" href="/posts/${encodeURIComponent(selected.id)}">Open post details</a>`
  if (!append) history.replaceState({}, '', `/engagement?post=${encodeURIComponent(postId)}`)
  const list = $('#replies-list'); const badge = $('#replies-status'); const button = $('#load-more-replies')
  if (!append) list.innerHTML = '<div class="skeleton-lines"><span></span><span></span></div>'
  badge.textContent = 'Loading'; button.disabled = true
  try {
    const query = repliesCursor ? `?after=${encodeURIComponent(repliesCursor)}&limit=25` : '?limit=25'
    const result = await request(`/api/read/posts/${encodeURIComponent(postId)}/replies${query}`)
    if (['unsupported', 'error', 'reauthorization_required'].includes(result.status)) {
      list.innerHTML = capabilityState(result.status === 'unsupported' ? 'Replies unsupported' : 'Replies unavailable', result.message, result.status)
      badge.textContent = result.status.replaceAll('_', ' '); button.classList.add('hidden'); return
    }
    const markup = result.data.items.map(replyCard).join('')
    if (append) list.insertAdjacentHTML('beforeend', markup)
    else list.innerHTML = markup || capabilityState('No replies', 'The post has no top-level replies visible to this account.', 'empty')
    repliesCursor = result.data.nextCursor
    button.classList.toggle('hidden', !repliesCursor)
    badge.textContent = result.data.status === 'empty' ? 'Empty' : 'Supported'
  } catch (error) { list.innerHTML = recoveryState(error); badge.textContent = 'Error' }
  finally { button.disabled = false; button.textContent = 'Load more replies' }
}

async function loadEngagement() {
  const list = $('#engagement-posts')
  try {
    const result = await request('/api/read/posts?limit=10')
    engagementPosts = result.items
    if (!result.items.length) { list.innerHTML = capabilityState('No posts found', 'There are no posts available for reply lookup.', 'empty'); return }
    list.innerHTML = result.items.map((post) => `<article class="compact-post"><p>${escapeHtml(post.text || `${post.mediaType || 'Media'} post`)}</p><small>${escapeHtml(formatDate(post.timestamp))}</small><button class="button secondary select-post" data-post-id="${escapeHtml(post.id)}" type="button">View replies</button></article>`).join('')
    list.querySelectorAll('.select-post').forEach((button) => button.addEventListener('click', () => loadReplies(button.dataset.postId)))
    const requested = new URLSearchParams(location.search).get('post')
    const initial = result.items.find((post) => post.id === requested) || result.items[0]
    if (initial) loadReplies(initial.id)
  } catch (error) { list.innerHTML = recoveryState(error) }
}

function comparisonValue(metrics, name) {
  const metric = metrics.find((item) => item.name === name)
  return metric ? metricValue(metric) : undefined
}

async function loadInsightComparison() {
  const node = $('#insight-comparison')
  const days = Number($('#insight-period')?.value || 7)
  node.innerHTML = '<div class="skeleton-lines"><span></span></div>'
  try {
    const result = await request(`/api/read/insights/account/compare?days=${days}`)
    if (result.status !== 'supported') { node.innerHTML = capabilityState('Comparison unavailable', result.message || 'No comparable metrics were returned.', result.status); return }
    const names = [...new Set([...result.data.current.metrics, ...result.data.previous.metrics].map((metric) => metric.name))]
    node.innerHTML = `<p class="period-context"><strong>${escapeHtml(result.data.current.period.label)}</strong> ${escapeHtml(formatDate(result.data.current.period.since))} – ${escapeHtml(formatDate(result.data.current.period.until))}; compared with ${escapeHtml(result.data.previous.period.label.toLowerCase())}.</p><div class="comparison-table" role="table" aria-label="Account metric comparison">${names.map((name) => {
      const current = comparisonValue(result.data.current.metrics, name)
      const previous = comparisonValue(result.data.previous.metrics, name)
      const change = typeof current === 'number' && typeof previous === 'number' ? current - previous : undefined
      return `<div class="comparison-row" role="row"><strong role="cell">${escapeHtml(name.replaceAll('_', ' '))}</strong><span role="cell">Current: ${typeof current === 'number' ? current.toLocaleString() : 'Unavailable'}</span><span role="cell">Previous: ${typeof previous === 'number' ? previous.toLocaleString() : 'Unavailable'}</span><span role="cell">Change: ${typeof change === 'number' ? `${change > 0 ? '+' : ''}${change.toLocaleString()}` : 'Unavailable'}</span></div>`
    }).join('')}</div><p class="muted-text">Followers are excluded because Meta does not support since/until for followers_count.</p>`
  } catch (error) { node.innerHTML = recoveryState(error) }
}

async function loadPostDetail() {
  const postId = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '')
  const detail = $('#post-detail'); const metrics = $('#post-detail-metrics'); const replies = $('#post-detail-replies')
  if (!/^\d{1,64}$/.test(postId)) {
    detail.innerHTML = capabilityState('Invalid post identifier', 'Return to Posts and choose a valid owned post.', 'error')
    metrics.innerHTML = capabilityState('Metrics unavailable', 'A valid post is required.', 'error')
    replies.innerHTML = capabilityState('Replies unavailable', 'A valid post is required.', 'error')
    return
  }
  const [postResult, metricResult, replyResult] = await Promise.allSettled([
    request(`/api/read/posts/${encodeURIComponent(postId)}`),
    request(`/api/read/posts/${encodeURIComponent(postId)}/insights`),
    request(`/api/read/posts/${encodeURIComponent(postId)}/replies?limit=5`),
  ])
  if (postResult.status === 'fulfilled') {
    const post = postResult.value.data; const permalink = safeUrl(post.permalink)
    detail.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">${escapeHtml(post.mediaType || 'Media type unavailable')}</p><h2>${escapeHtml(post.text || 'No text returned')}</h2></div><button id="refresh-post-detail" class="button secondary" type="button">Refresh</button></div>${mediaMarkup(post)}<dl class="details"><div><dt>Post ID</dt><dd>${escapeHtml(post.id)}</dd></div><div><dt>Published</dt><dd>${escapeHtml(formatDate(post.timestamp))}</dd></div>${post.topicTag ? `<div><dt>Topic</dt><dd>${escapeHtml(post.topicTag)}</dd></div>` : ''}</dl><div class="actions">${permalink ? `<a class="button primary" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">View on Threads</a>` : '<span class="muted-text">Permalink unavailable</span>'}<a class="button secondary" href="/engagement?post=${encodeURIComponent(post.id)}">Open engagement</a></div>`
    $('#refresh-post-detail')?.addEventListener('click', loadPostDetail)
  } else detail.innerHTML = recoveryState(postResult.reason)
  if (metricResult.status === 'fulfilled') metrics.innerHTML = metricResult.value.status === 'supported' ? metricCards(metricResult.value.data) : capabilityState('Metrics unavailable', metricResult.value.message || 'No metrics returned.', metricResult.value.status)
  else metrics.innerHTML = recoveryState(metricResult.reason)
  if (replyResult.status === 'fulfilled') {
    const result = replyResult.value
    replies.innerHTML = result.status === 'supported'
      ? (result.data.items.length ? `${result.data.items.map(replyCard).join('')}<a class="text-link" href="/engagement?post=${encodeURIComponent(postId)}">See reply workflow</a>` : capabilityState('No replies', 'No top-level replies are visible for this post.', 'empty'))
      : capabilityState('Replies unavailable', result.message || 'Replies are unavailable.', result.status)
  } else replies.innerHTML = recoveryState(replyResult.reason)
}

async function loadInsights() {
  loadInsightComparison()
  const accountNode = $('#account-insights'); const badge = $('#account-insights-status'); const postsNode = $('#insight-posts')
  try {
    const result = await request('/api/read/insights/account')
    badge.textContent = result.status.replace('_', ' ')
    if (result.status === 'supported') accountNode.innerHTML = metricCards(result.data)
    else accountNode.innerHTML = capabilityState('Account insights unavailable', result.message || 'No account metrics were returned.', result.status)
  } catch (error) { badge.textContent = 'Error'; accountNode.innerHTML = recoveryState(error) }
  try {
    const posts = await request('/api/read/posts?limit=5')
    if (!posts.items.length) { postsNode.innerHTML = capabilityState('No posts found', 'Post insights need an owned post.', 'empty'); return }
    const entries = await Promise.all(posts.items.map(async (post) => {
      try { return { post, result: await request(`/api/read/posts/${encodeURIComponent(post.id)}/insights`) } }
      catch (error) { return { post, error } }
    }))
    postsNode.innerHTML = entries.map(({ post, result, error }) => {
      const heading = escapeHtml(post.text || `${post.mediaType || 'Media'} post`)
      if (error) return `<article class="insight-row"><h3>${heading}</h3>${recoveryState(error)}</article>`
      if (result.status !== 'supported') return `<article class="insight-row"><h3>${heading}</h3>${capabilityState('Metrics unavailable', result.message || 'No metrics returned.', result.status)}</article>`
      return `<article class="insight-row"><div><h3>${heading}</h3><p>${escapeHtml(formatDate(post.timestamp))}</p></div><div class="metric-grid compact">${metricCards(result.data)}</div></article>`
    }).join('')
  } catch (error) { postsNode.innerHTML = recoveryState(error) }
}

let auditCursor
function auditLabel(eventType) {
  return ({ oauth_connected: 'Threads connected', oauth_disconnected: 'Threads disconnected', publish_attempt: 'Publish started', publish_succeeded: 'Publish succeeded', publish_failed: 'Publish failed' })[eventType] || 'Operator event'
}
async function loadAudit(append = false) {
  const list = $('#audit-list'); const button = $('#load-more-audit'); const status = $('#audit-status')
  if (!append) { auditCursor = undefined; list.innerHTML = '<div class="skeleton-lines"><span></span><span></span></div>' }
  button.disabled = true
  try {
    const query = auditCursor ? `?after=${encodeURIComponent(auditCursor)}&limit=25` : '?limit=25'
    const result = await request('/api/audit/events' + query)
    const markup = result.items.map((event) => `<article class="activity-row"><div><strong>${escapeHtml(auditLabel(event.eventType))}</strong><p>${escapeHtml(formatDate(event.occurredAt))}</p></div><div><span class="badge ${event.outcome === 'success' ? 'supported' : event.outcome === 'failure' ? 'danger' : 'neutral'}">${escapeHtml(event.outcome)}</span>${event.resourceId ? `<small>Resource ${escapeHtml(event.resourceId)}</small>` : ''}${event.errorCategory ? `<small>Category ${escapeHtml(event.errorCategory)}</small>` : ''}</div></article>`).join('')
    if (append) list.insertAdjacentHTML('beforeend', markup)
    else list.innerHTML = markup || capabilityState('No activity recorded', 'Safe operational events will appear after connection or publishing actions.', 'empty')
    auditCursor = result.nextCursor
    button.classList.toggle('hidden', !auditCursor)
    status.textContent = result.status === 'empty' ? 'Empty' : 'Supported'
  } catch (error) { if (!append) list.innerHTML = recoveryState(error); status.textContent = 'Error' }
  finally { button.disabled = false; button.textContent = 'Load more activity' }
}

let composeConnected = false
let composePublishing = false
let composeLocked = false
let composeRequestId

function composeValidation() {
  const input = $('#post-text')
  if (!input) return false
  const text = input.value
  const bytes = new TextEncoder().encode(text).length
  const links = new Set(text.match(/https?:\/\/[^\s<>()]+/gi) || [])
  const errorNode = $('#compose-validation')
  const countNode = $('#compose-count')
  const badge = $('#compose-validity')
  countNode.textContent = `${bytes} / 500 UTF-8 bytes`
  countNode.classList.toggle('danger-text', bytes > 500)
  let message = ''
  if (!text.trim()) message = 'Post text is required.'
  else if (bytes > 500) message = 'Post text exceeds Threads’ 500-byte limit. Emojis may use multiple UTF-8 bytes.'
  else if (links.size > 5) message = 'Threads allows no more than 5 unique links in a post.'
  errorNode.textContent = message
  badge.className = `badge ${message ? 'neutral' : 'supported'}`
  badge.textContent = message ? (text ? 'Needs review' : 'Empty') : 'Ready'
  $('#preview-text').textContent = text || 'Your post preview will appear here.'
  $('#preview-text').classList.toggle('muted-text', !text)
  const valid = !message && composeConnected && !composePublishing && !composeLocked
  $('#publish-button').disabled = !valid
  return valid
}

function renderPublishResult(result) {
  const node = $('#publish-result')
  node.classList.remove('hidden')
  const permalink = safeUrl(result.permalink)
  node.innerHTML = `<div class="publish-success"><span class="badge supported">Published</span><h2>Your Thread is live</h2><p>${escapeHtml(result.message || 'Threads accepted and published the post.')}</p><dl class="details"><div><dt>Post ID</dt><dd>${escapeHtml(result.postId)}</dd></div>${result.timestamp ? `<div><dt>Published</dt><dd>${escapeHtml(formatDate(result.timestamp))}</dd></div>` : ''}</dl><div class="actions">${permalink ? `<a class="button primary" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">View Post</a>` : ''}<a class="button secondary" href="/posts">Open Posts</a><button id="compose-again" class="button ghost" type="button">Compose another</button></div></div>`
  $('#compose-again').addEventListener('click', () => {
    $('#post-text').value = ''; composeRequestId = undefined; composeLocked = false; node.classList.add('hidden'); composeValidation(); $('#post-text').focus()
  })
}

function renderPublishError(error) {
  const node = $('#publish-result')
  const uncertain = error.code === 'PUBLISH_RESULT_UNCERTAIN' || error.code === 'DUPLICATE_IN_PROGRESS'
  node.classList.remove('hidden')
  node.innerHTML = `<div class="publish-error"><span class="badge danger">Publish not confirmed</span><h2>${uncertain ? 'Check Posts before trying again' : 'Post was not published'}</h2><p>${escapeHtml(error.message || errorMessages[error.code] || 'Publishing failed safely.')}</p><div class="actions">${error.reauthorizationRequired || error.code === 'CAPABILITY_NOT_GRANTED' ? '<a class="button primary" href="/auth/threads/start">Reconnect Threads</a>' : ''}<a class="button secondary" href="/posts">Check Posts</a></div></div>`
}

async function loadCompose() {
  const accountNode = $('#compose-account')
  try {
    const connection = await request('/api/connection/status')
    composeConnected = connection.status === 'connected'
    if (!composeConnected) {
      accountNode.innerHTML = capabilityState('Connect Threads before publishing', 'Publishing requires a connected account with threads_content_publish permission.', 'unsupported')
      $('#preview-account').textContent = 'No account connected'
    } else {
      const label = connection.username ? `@${connection.username}` : (connection.displayName || `Account ${connection.accountId}`)
      accountNode.innerHTML = `<div class="connected-strip"><span class="badge supported">Connected</span><div><strong>Publishing as ${escapeHtml(label)}</strong><p>Posts are sent only after you click Publish.</p></div><a class="text-link" href="/settings">Connection settings</a></div>`
      $('#preview-account').textContent = label
    }
  } catch (error) {
    accountNode.innerHTML = recoveryState(error)
  }
  composeValidation()
}

async function publishCompose(event) {
  event.preventDefault()
  if (!composeValidation() || composePublishing) return
  composePublishing = true
  const button = $('#publish-button')
  button.disabled = true; button.textContent = 'Publishing…'; button.setAttribute('aria-busy', 'true')
  $('#publish-result').classList.add('hidden')
  composeRequestId ||= crypto.randomUUID()
  try {
    const result = await request('/api/publish/posts', { method: 'POST', body: JSON.stringify({ text: $('#post-text').value, requestId: composeRequestId }) })
    composeLocked = true
    renderPublishResult(result)
    request('/api/read/posts?limit=1').catch(() => undefined)
  } catch (error) {
    const uncertain = error.code === 'PUBLISH_RESULT_UNCERTAIN' || error.code === 'DUPLICATE_IN_PROGRESS'
    composeLocked = uncertain
    if (!uncertain) composeRequestId = undefined
    renderPublishError(error)
  } finally {
    composePublishing = false; button.textContent = 'Publish to Threads'; button.removeAttribute('aria-busy'); composeValidation()
  }
}

async function loadWorkspace() {
  if (page === 'setup') return loadSetup()
  if (page === 'settings') return loadSettings()
  if (page === 'dashboard') return loadDashboard()
  if (page === 'posts') return loadPosts()
  if (page === 'post-detail') return loadPostDetail()
  if (page === 'compose') return loadCompose()
  if (page === 'engagement') return loadEngagement()
  if (page === 'insights') return loadInsights()
  if (page === 'activity') return loadAudit()
}

$('#post-text')?.addEventListener('input', () => { if (!composePublishing && !composeLocked) composeRequestId = undefined; composeValidation() })
$('#compose-form')?.addEventListener('submit', publishCompose)
$('#load-more-posts')?.addEventListener('click', () => { $('#load-more-posts').textContent = 'Loading…'; loadPosts(true) })
$('#posts-search')?.addEventListener('input', renderLoadedPosts)
$('#posts-sort')?.addEventListener('change', renderLoadedPosts)
$('#insight-period')?.addEventListener('change', loadInsightComparison)
$('#load-more-replies')?.addEventListener('click', () => { $('#load-more-replies').textContent = 'Loading…'; loadReplies(selectedPostId, true) })
$('#load-more-audit')?.addEventListener('click', () => { $('#load-more-audit').textContent = 'Loading…'; loadAudit(true) })
$('#recheck-configuration')?.addEventListener('click', loadSetup)
$('#project-form')?.addEventListener('submit', selectCloudflareProject)
$('#configuration-form')?.addEventListener('submit', applyProductionConfiguration)
$('#disconnect-cloudflare')?.addEventListener('click', disconnectCloudflare)
$('#test-sparkpod')?.addEventListener('click', testSparkPod)
document.querySelectorAll('[data-copy-value]').forEach((button) => button.addEventListener('click', () => copySafeValue(button.dataset.copyValue, button)))
async function init() {
  try { showConfiguration(await request('/api/configuration')) } catch { /* safe readiness is best effort */ }
  if (page !== 'setup' && !setupWasCompleted()) {
    location.replace('/setup')
    return
  }
  await loadWorkspace()
}

init()
