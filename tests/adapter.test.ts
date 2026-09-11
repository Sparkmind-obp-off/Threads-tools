import { describe, expect, it, vi } from 'vitest'
import { MetaThreadsProvider } from '../src/threads/adapter'
import type { AppConfig } from '../src/config/env'

const config: AppConfig = {
  threadsAppId: '123', threadsAppSecret: 'server-secret',
  threadsRedirectUri: 'https://app.example.com/auth/threads/callback',
  threadsApiBaseUrl: 'https://graph.threads.com', threadsApiVersion: 'v1.0',
  sessionSecret: 'x'.repeat(32), operatorPassword: 'password',
}

describe('Meta Threads adapter', () => {
  it('requests only threads_basic during Phase 1', () => {
    const url = new URL(new MetaThreadsProvider(config).authorizationUrl('state'))
    expect(url.origin + url.pathname).toBe('https://threads.com/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe('threads_basic')
    expect(url.searchParams.get('state')).toBe('state')
  })

  it('normalizes account data and drops unknown sensitive fields', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: '42', username: 'operator', name: 'Operator', access_token: 'must-not-leak' }), { status: 200 })) as unknown as typeof fetch
    const account = await new MetaThreadsProvider(config, fetcher).getAccount('server-token')
    expect(account).toEqual({ id: '42', username: 'operator', name: 'Operator' })
    expect(account).not.toHaveProperty('access_token')
  })

  it('maps account API errors to a safe application error', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'raw provider details', code: 190 } }), { status: 401 })) as unknown as typeof fetch
    await expect(new MetaThreadsProvider(config, fetcher).getAccount('server-token')).rejects.toMatchObject({ code: 'ACCOUNT_LOOKUP_FAILED' })
  })
})
