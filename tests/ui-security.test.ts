import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import app from '../src/index'

describe('Phase 3 UI and browser security boundary', () => {
  it.each([
    ['/', 'Recent posts'], ['/posts', 'Your Threads posts'], ['/engagement', 'Top-level replies'],
    ['/compose', 'Create a Thread'], ['/insights', 'Account insights'], ['/settings', 'Connection status'],
  ])('renders the real-data workspace shell for %s', async (path, label) => {
    const response = await app.request(path)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain(label)
    expect(html).toContain('Operator sign in')
    expect(html).not.toContain('server-secret')
    expect(html).not.toContain('access_token')
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
    expect(assets).not.toContain('THREADS_APP_SECRET')
    expect(assets).not.toContain('SESSION_SECRET')
    expect(assets).not.toContain('Bearer server-token')
    expect(assets).not.toContain('Authorization:')
    expect(assets).not.toContain('THREADS_APP_ID')
    expect(assets).not.toContain('access_token')
    expect(assets).not.toContain('refresh_token')
    expect(assets).not.toContain('oauth code')
  })
})
