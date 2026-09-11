import { describe, expect, it, vi } from 'vitest'
import { MetaThreadsProvider } from '../src/threads/adapter'
import type { AppConfig } from '../src/config/env'

const config: AppConfig = {
  threadsAppId: '123', threadsAppSecret: 'server-secret',
  threadsRedirectUri: 'https://app.example.com/auth/threads/callback',
  threadsApiBaseUrl: 'https://graph.threads.com', threadsApiVersion: 'v1.0',
  sessionSecret: 'x'.repeat(32), operatorPassword: 'password',
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Meta Threads adapter', () => {
  it('requests the Phase 3 publish permission with existing read permissions', () => {
    const url = new URL(new MetaThreadsProvider(config).authorizationUrl('state'))
    expect(url.origin + url.pathname).toBe('https://threads.com/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe('threads_basic,threads_content_publish,threads_read_replies,threads_manage_insights')
    expect(url.searchParams.get('scope')).toContain('threads_content_publish')
    expect(url.searchParams.get('state')).toBe('state')
  })

  it('normalizes supported account fields and drops unknown sensitive fields', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ id: '42', username: 'operator', name: 'Operator', threads_biography: 'Bio', is_verified: false, access_token: 'must-not-leak' }))
    const account = await new MetaThreadsProvider(config, fetcher as unknown as typeof fetch).getAccount('server-token')
    expect(account).toEqual({ id: '42', username: 'operator', name: 'Operator', biography: 'Bio', isVerified: false })
    expect(account).not.toHaveProperty('access_token')
  })

  it('reads posts with a bearer token, supported fields, and cursor pagination', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      data: [{ id: '10', text: 'Real post', media_type: 'TEXT_POST', timestamp: '2026-09-11T10:00:00+0000' }],
      paging: { cursors: { after: 'NEXT_CURSOR' } },
    }))
    const result = await new MetaThreadsProvider(config, fetcher as unknown as typeof fetch).listPosts('server-token', 'CURSOR', 12)
    expect(result).toMatchObject({ status: 'supported', nextCursor: 'NEXT_CURSOR', items: [{ id: '10', text: 'Real post', mediaType: 'TEXT_POST' }] })
    const [input, init] = fetcher.mock.calls[0]
    const url = new URL(String(input))
    expect(url.pathname).toBe('/v1.0/me/threads')
    expect(url.searchParams.get('after')).toBe('CURSOR')
    expect(url.searchParams.get('access_token')).toBeNull()
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer server-token')
  })

  it('creates and publishes a text container without putting the token in URLs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: 'container-10' }))
      .mockResolvedValueOnce(response({ id: 'post-11' }))
      .mockResolvedValueOnce(response({ id: 'post-11', permalink: 'https://www.threads.net/@operator/post/abc', timestamp: '2026-09-11T10:00:00+0000' }))
    const provider = new MetaThreadsProvider(config, fetcher as unknown as typeof fetch)
    expect(await provider.createTextContainer('server-token', '42', 'Real text')).toBe('container-10')
    expect(await provider.publishContainer('server-token', '42', 'container-10')).toBe('post-11')
    expect(await provider.getPost('server-token', 'post-11')).toMatchObject({ id: 'post-11', permalink: 'https://www.threads.net/@operator/post/abc' })

    const createUrl = new URL(String(fetcher.mock.calls[0][0]))
    const createInit = fetcher.mock.calls[0][1]
    expect(createUrl.pathname).toBe('/v1.0/42/threads')
    expect(createUrl.searchParams.get('access_token')).toBeNull()
    expect((createInit?.headers as Record<string, string>).Authorization).toBe('Bearer server-token')
    expect(String(createInit?.body)).toContain('media_type=TEXT')
    expect(String(createInit?.body)).toContain('text=Real+text')

    const publishUrl = new URL(String(fetcher.mock.calls[1][0]))
    expect(publishUrl.pathname).toBe('/v1.0/42/threads_publish')
    expect(String(fetcher.mock.calls[1][1]?.body)).toBe('creation_id=container-10')
  })

  it('normalizes publish authorization, rate-limit, rejection, and provider availability failures', async () => {
    const permission = vi.fn(async () => response({ error: { message: 'raw permission payload', code: 10 } }, 403))
    await expect(new MetaThreadsProvider(config, permission as unknown as typeof fetch).createTextContainer('secret', '42', 'Text')).rejects.toMatchObject({ code: 'CAPABILITY_NOT_GRANTED' })

    const limited = vi.fn(async () => response({ error: { message: 'raw quota payload', code: 613 } }, 429))
    await expect(new MetaThreadsProvider(config, limited as unknown as typeof fetch).publishContainer('secret', '42', 'container')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true })

    const rejected = vi.fn(async () => response({ error: { message: 'raw validation payload', code: 100 } }, 400))
    await expect(new MetaThreadsProvider(config, rejected as unknown as typeof fetch).createTextContainer('secret', '42', 'Text')).rejects.toMatchObject({ code: 'CONTAINER_CREATION_FAILED' })

    const unavailable = vi.fn(async () => response({ error: { message: 'raw outage payload', code: 2 } }, 503))
    await expect(new MetaThreadsProvider(config, unavailable as unknown as typeof fetch).publishContainer('secret', '42', 'container')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true })
  })

  it('rejects malformed publish responses safely', async () => {
    const fetcher = vi.fn(async () => response({ ok: true, access_token: 'must-not-leak' }))
    await expect(new MetaThreadsProvider(config, fetcher as unknown as typeof fetch).createTextContainer('secret', '42', 'Text')).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' })
  })

  it('reads supported top-level replies', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ data: [{ id: '11', text: 'Reply', username: 'reader', has_replies: true, is_reply: true }] }))
    const result = await new MetaThreadsProvider(config, fetcher as unknown as typeof fetch).listReplies('server-token', '10')
    expect(result.items[0]).toMatchObject({ id: '11', text: 'Reply', username: 'reader', hasReplies: true, isReply: true })
    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe('/v1.0/10/replies')
  })

  it('reads post and account insight contracts', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ data: [{ name: 'likes', period: 'lifetime', values: [{ value: 7 }] }]}))
    const provider = new MetaThreadsProvider(config, fetcher as unknown as typeof fetch)
    expect(await provider.getPostInsights('server-token', '10')).toMatchObject([{ name: 'likes', period: 'lifetime', values: [{ value: 7 }] }])
    expect(await provider.getAccountInsights('server-token', '42')).toMatchObject([{ name: 'likes' }])
    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe('/v1.0/10/insights')
    expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe('/v1.0/42/threads_insights')
  })

  it('normalizes permission and expired-token failures safely', async () => {
    const denied = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ error: { message: 'raw provider details', code: 10 } }, 403))
    await expect(new MetaThreadsProvider(config, denied as unknown as typeof fetch).listReplies('secret', '10')).rejects.toMatchObject({ code: 'CAPABILITY_NOT_GRANTED', status: 403 })

    const expired = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ error: { message: 'token text', code: 190 } }, 401))
    await expect(new MetaThreadsProvider(config, expired as unknown as typeof fetch).getAccount('secret')).rejects.toMatchObject({ code: 'AUTHORIZATION_EXPIRED', status: 401 })
  })

  it('maps other provider errors without returning raw provider messages', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ error: { message: 'raw provider details', code: 2 } }, 500))
    await expect(new MetaThreadsProvider(config, fetcher as unknown as typeof fetch).getAccount('server-token')).rejects.toMatchObject({ code: 'ACCOUNT_LOOKUP_FAILED', retryable: true })
    await expect(new MetaThreadsProvider(config, fetcher as unknown as typeof fetch).getAccount('server-token')).rejects.not.toThrow('raw provider details')
  })
})
