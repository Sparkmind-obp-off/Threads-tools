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
    throw error
  }
  return data
}

function showConfiguration(data) {
  if (data.status === 'not_configured') {
    configurationAlert.classList.remove('hidden')
    configurationAlert.innerHTML = `<strong>Configuration required</strong><p>The server is missing: ${data.missing.map(escapeHtml).join(', ')}. Add these values as server secrets before connecting Threads.</p>`
  }
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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function showResultNotice(container) {
  const params = new URLSearchParams(location.search)
  const result = params.get('result')
  if (!result) return
  const notice = document.createElement('div')
  notice.className = `alert ${result === 'connected' ? 'success' : 'error'}`
  notice.setAttribute('role', 'status')
  notice.textContent = result === 'connected' ? 'Threads account connected successfully.' : (errorMessages[params.get('code')] || 'The connection could not be completed safely.')
  container.prepend(notice)
  history.replaceState({}, '', location.pathname)
}

function renderConnection(connection) {
  $('#connection-loading').classList.add('hidden')
  const content = $('#connection-content')
  const badge = $('#status-badge')
  content.classList.remove('hidden')
  badge.className = 'badge'
  if (connection.status === 'connected') {
    badge.classList.add('supported')
    badge.textContent = 'Connected'
    content.innerHTML = `<div class="account-card"><div class="account-avatar" aria-hidden="true">${escapeHtml((connection.displayName || connection.username || 'T')[0].toUpperCase())}</div><div><h3>${escapeHtml(connection.displayName || connection.username || 'Threads account')}</h3><p>${connection.username ? '@' + escapeHtml(connection.username) : 'Account ID ' + escapeHtml(connection.accountId)}</p></div></div><dl class="details"><div><dt>Account ID</dt><dd>${escapeHtml(connection.accountId)}</dd></div><div><dt>Connected</dt><dd>${new Date(connection.connectedAt).toLocaleString()}</dd></div>${connection.tokenExpiresAt ? `<div><dt>Authorization expires</dt><dd>${new Date(connection.tokenExpiresAt).toLocaleString()}</dd></div>` : ''}</dl><div class="actions"><a class="button secondary" href="/auth/threads/start">Reconnect Threads</a><button id="disconnect" class="button danger" type="button">Disconnect</button></div>`
    $('#disconnect').addEventListener('click', disconnect)
  } else {
    badge.classList.add('neutral')
    badge.textContent = 'Disconnected'
    content.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">↗</div><h3>No Threads account connected</h3><p>Start the provider authorization flow. Only the <code>threads_basic</code> permission is requested in Phase 1.</p><a class="button primary" href="/auth/threads/start">Connect Threads</a></div>`
  }
}

async function disconnect() {
  if (!confirm('Disconnect this Threads account? The stored encrypted credential will be deleted.')) return
  const button = $('#disconnect')
  button.disabled = true
  button.textContent = 'Disconnecting…'
  try { renderConnection(await request('/api/connection/disconnect', { method: 'POST' })) }
  catch (error) { alert(error.message); button.disabled = false; button.textContent = 'Disconnect' }
}

async function loadWorkspace() {
  if (page !== 'settings') { showWorkspace(); return }
  try {
    const connection = await request('/api/connection/status')
    showWorkspace()
    renderConnection(connection)
    showResultNotice(workspace)
  } catch (error) {
    showWorkspace()
    $('#connection-loading').classList.add('hidden')
    $('#connection-content').classList.remove('hidden')
    $('#connection-content').innerHTML = `<div class="alert error" role="alert">${escapeHtml(error.message)}</div>`
  }
}

$('#login-form')?.addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = event.currentTarget.querySelector('button')
  const errorNode = $('#login-error')
  button.disabled = true; button.textContent = 'Signing in…'; errorNode.textContent = ''
  try {
    await request('/api/session', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) })
    $('#password').value = ''
    await loadWorkspace()
  } catch (error) { errorNode.textContent = error.message }
  finally { button.disabled = false; button.textContent = 'Sign in' }
})

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
