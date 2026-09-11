const $ = (selector) => document.querySelector(selector)
const page = document.body.dataset.page
const configurationAlert = $('#configuration-alert')
const loginPanel = $('#login-panel')
const workspace = $('#workspace')
const signOut = $('#sign-out')

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

function showLogin() {
  loginPanel.classList.remove('hidden')
  workspace.classList.add('hidden')
  signOut.classList.add('hidden')
}

function showWorkspace() {
  loginPanel.classList.add('hidden')
  workspace.classList.remove('hidden')
  signOut.classList.remove('hidden')
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
  return `<article class="post-card" data-id="${escapeHtml(post.id)}">${mediaMarkup(post)}<div class="post-body"><div class="post-meta"><span>${escapeHtml(formatDate(post.timestamp))}</span><span>${escapeHtml(post.mediaType || 'Media type unavailable')}</span></div><p class="post-text">${text}</p><div class="post-tags">${post.topicTag ? `<span class="badge neutral">${escapeHtml(post.topicTag)}</span>` : ''}${post.isQuotePost ? '<span class="badge neutral">Quote</span>' : ''}</div><div class="post-actions">${permalink ? `<a class="text-link" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">Open on Threads</a>` : '<span class="muted-text">Permalink unavailable</span>'}${select}</div></div></article>`
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

async function loadDashboard() {
  const accountNode = $('#dashboard-account'); const postsNode = $('#dashboard-posts')
  const engagementNode = $('#dashboard-engagement'); const insightsNode = $('#dashboard-insights')
  const [account, posts, insights] = await Promise.allSettled([
    request('/api/read/account'), request('/api/read/posts?limit=4'), request('/api/read/insights/account'),
  ])
  if (account.status === 'fulfilled') {
    const item = account.value.data
    accountNode.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Connected account</p><h2>${escapeHtml(item.name || item.username || 'Threads account')}</h2></div><span class="badge supported">Live</span></div><div class="account-card">${item.profilePictureUrl && safeUrl(item.profilePictureUrl) ? `<img class="account-avatar image" src="${escapeHtml(safeUrl(item.profilePictureUrl))}" alt="">` : `<div class="account-avatar">${escapeHtml((item.name || item.username || 'T')[0])}</div>`}<div><strong>${item.username ? '@' + escapeHtml(item.username) : escapeHtml(item.id)}</strong><p>${escapeHtml(item.biography || 'Biography unavailable')}</p></div></div>`
  } else accountNode.innerHTML = recoveryState(account.reason)
  if (posts.status === 'fulfilled') {
    postsNode.innerHTML = posts.value.items.length ? posts.value.items.map((item) => postCard(item)).join('') : capabilityState('No posts yet', 'Threads returned a valid empty post list.', 'empty')
    const first = posts.value.items[0]
    if (first) {
      try {
        const replies = await request(`/api/read/posts/${encodeURIComponent(first.id)}/replies?limit=10`)
        if (replies.status === 'unsupported') engagementNode.innerHTML = capabilityState('Replies unsupported', replies.message)
        else if (replies.status === 'error') engagementNode.innerHTML = capabilityState('Replies unavailable', replies.message, 'error')
        else engagementNode.innerHTML = `<p class="eyebrow">Latest-post engagement</p><h2>${replies.data.items.length.toLocaleString()}</h2><p>Top-level ${replies.data.items.length === 1 ? 'reply' : 'replies'} returned for the latest post.</p><a class="text-link" href="/engagement">Open engagement</a>`
      } catch (error) { engagementNode.innerHTML = recoveryState(error) }
    } else engagementNode.innerHTML = capabilityState('No engagement to inspect', 'Publish activity is required before replies can be read.', 'empty')
  } else {
    postsNode.innerHTML = recoveryState(posts.reason)
    engagementNode.innerHTML = capabilityState('Engagement unavailable', 'Posts could not be loaded.', 'error')
  }
  if (insights.status === 'fulfilled') {
    const data = insights.value
    if (data.status === 'supported') insightsNode.innerHTML = `<p class="eyebrow">Account insights</p><div class="mini-metrics">${data.data.slice(0, 3).map((metric) => `<div><strong>${(metricValue(metric) ?? '—').toLocaleString?.() || '—'}</strong><span>${escapeHtml(metric.title || metric.name)}</span></div>`).join('')}</div><a class="text-link" href="/insights">View insights</a>`
    else insightsNode.innerHTML = capabilityState('Insights unavailable', data.message || 'No account metrics were returned.', data.status)
  } else insightsNode.innerHTML = recoveryState(insights.reason)
}

let postsCursor
async function loadPosts(append = false) {
  const list = $('#posts-list'); const button = $('#load-more-posts')
  if (!append) list.innerHTML = '<div class="skeleton-lines"><span></span><span></span></div>'
  button.disabled = true
  try {
    const query = postsCursor ? `?after=${encodeURIComponent(postsCursor)}&limit=12` : '?limit=12'
    const result = await request('/api/read/posts' + query)
    const markup = result.items.map((item) => postCard(item)).join('')
    if (append) list.insertAdjacentHTML('beforeend', markup)
    else list.innerHTML = markup || capabilityState('No posts found', 'Threads returned a valid empty dataset.', 'empty')
    postsCursor = result.nextCursor
    button.classList.toggle('hidden', !postsCursor)
    $('#posts-count').textContent = result.status === 'empty' ? 'Empty' : 'Loaded'
  } catch (error) { if (!append) list.innerHTML = recoveryState(error) }
  finally { button.disabled = false; button.textContent = 'Load more' }
}

let selectedPostId
let repliesCursor
async function loadReplies(postId, append = false) {
  selectedPostId = postId
  if (!append) repliesCursor = undefined
  const list = $('#replies-list'); const badge = $('#replies-status'); const button = $('#load-more-replies')
  if (!append) list.innerHTML = '<div class="skeleton-lines"><span></span><span></span></div>'
  badge.textContent = 'Loading'; button.disabled = true
  try {
    const query = repliesCursor ? `?after=${encodeURIComponent(repliesCursor)}&limit=25` : '?limit=25'
    const result = await request(`/api/read/posts/${encodeURIComponent(postId)}/replies${query}`)
    if (result.status === 'unsupported' || result.status === 'error') {
      list.innerHTML = capabilityState(result.status === 'unsupported' ? 'Replies unsupported' : 'Replies unavailable', result.message, result.status)
      badge.textContent = result.status === 'unsupported' ? 'Unsupported' : 'Error'; button.classList.add('hidden'); return
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
    if (!result.items.length) { list.innerHTML = capabilityState('No posts found', 'There are no posts available for reply lookup.', 'empty'); return }
    list.innerHTML = result.items.map((post) => `<article class="compact-post"><p>${escapeHtml(post.text || `${post.mediaType || 'Media'} post`)}</p><small>${escapeHtml(formatDate(post.timestamp))}</small><button class="button secondary select-post" data-post-id="${escapeHtml(post.id)}" type="button">View replies</button></article>`).join('')
    list.querySelectorAll('.select-post').forEach((button) => button.addEventListener('click', () => loadReplies(button.dataset.postId)))
  } catch (error) { list.innerHTML = recoveryState(error) }
}

async function loadInsights() {
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
  showWorkspace()
  if (page === 'settings') return loadSettings()
  if (page === 'dashboard') return loadDashboard()
  if (page === 'posts') return loadPosts()
  if (page === 'compose') return loadCompose()
  if (page === 'engagement') return loadEngagement()
  if (page === 'insights') return loadInsights()
}

$('#login-form')?.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = event.currentTarget.querySelector('button'); const errorNode = $('#login-error')
  button.disabled = true; button.textContent = 'Signing in…'; errorNode.textContent = ''
  try { await request('/api/session', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; await loadWorkspace() }
  catch (error) { errorNode.textContent = error.message }
  finally { button.disabled = false; button.textContent = 'Sign in' }
})

$('#post-text')?.addEventListener('input', () => { if (!composePublishing && !composeLocked) composeRequestId = undefined; composeValidation() })
$('#compose-form')?.addEventListener('submit', publishCompose)
$('#load-more-posts')?.addEventListener('click', () => { $('#load-more-posts').textContent = 'Loading…'; loadPosts(true) })
$('#load-more-replies')?.addEventListener('click', () => { $('#load-more-replies').textContent = 'Loading…'; loadReplies(selectedPostId, true) })
signOut?.addEventListener('click', async () => { await request('/api/session', { method: 'DELETE' }); showLogin() })

async function init() {
  try { showConfiguration(await request('/api/configuration')) } catch { /* public status is best effort */ }
  try {
    const session = await request('/api/session')
    if (!session.authenticated) return showLogin()
    await loadWorkspace()
  } catch { showLogin() }
}

init()
