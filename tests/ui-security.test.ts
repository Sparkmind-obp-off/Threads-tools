import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import app from '../src/index'

describe('Phase 2 UI and browser security boundary', () => {
  it.each([
    ['/', 'Recent posts'], ['/posts', 'Your Threads posts'], ['/engagement', 'Top-level replies'],
    ['/insights', 'Account insights'], ['/settings', 'Connection status'],
  ])('renders the real-data workspace shell for %s', async (path, label) => {
    const response = await app.request(path)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain(label)
    expect(html).toContain('Operator sign in')
    expect(html).not.toContain('server-secret')
    expect(html).not.toContain('access_token')
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
  })
})
