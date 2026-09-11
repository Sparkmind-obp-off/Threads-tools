import { describe, expect, it, vi } from 'vitest'
import { ThreadsReadService } from '../src/services/read'
import { AppError } from '../src/domain/types'
import type { CredentialStore } from '../src/storage/repositories'
import type { ThreadsProvider } from '../src/threads/adapter'

function credentials(value: Awaited<ReturnType<CredentialStore['getCredential']>>): CredentialStore {
  return { getCredential: vi.fn(async () => value) }
}

function provider(overrides: Partial<ThreadsProvider> = {}): ThreadsProvider {
  return {
    authorizationUrl: () => '', exchangeCode: vi.fn(), exchangeLongLived: vi.fn(),
    getAccount: vi.fn(async () => ({ id: '42', username: 'operator' })),
    listPosts: vi.fn(async () => ({ status: 'supported', items: [{ id: '10', text: 'Post' }], nextCursor: 'NEXT' })),
    listReplies: vi.fn(async () => ({ status: 'empty', items: [] })),
    getPostInsights: vi.fn(async () => [{ name: 'likes', total: 2 }]),
    getAccountInsights: vi.fn(async () => [{ name: 'followers_count', total: 100 }]),
    getAccountInsightsRange: vi.fn(async () => [{ name: 'likes', total: 5 }]),
    getPost: vi.fn(async () => ({ id: '10', text: 'Post' })),
    ...overrides,
  } as ThreadsProvider
}

const validCredential = { accountId: '42', accessToken: 'server-token' }

describe('Threads read service', () => {
  it('reads account and cursor-paginated posts with a server-side credential', async () => {
    const api = provider()
    const service = new ThreadsReadService(api, credentials(validCredential))
    expect(await service.account()).toEqual({ id: '42', username: 'operator' })
    expect(await service.posts('CURSOR', 12)).toMatchObject({ nextCursor: 'NEXT', items: [{ id: '10' }] })
    expect(api.listPosts).toHaveBeenCalledWith('server-token', 'CURSOR', 12)
  })

  it('reads a single normalized post for detail views', async () => {
    const api = provider()
    const service = new ThreadsReadService(api, credentials(validCredential))
    expect(await service.post('10')).toEqual({ id: '10', text: 'Post' })
    expect(api.getPost).toHaveBeenCalledWith('server-token', '10')
  })

  it('returns explicit supported and empty capability states', async () => {
    const service = new ThreadsReadService(provider(), credentials(validCredential))
    expect(await service.replies('10')).toMatchObject({ status: 'supported', data: { status: 'empty', items: [] } })
    expect(await service.accountInsights()).toMatchObject({ status: 'supported', data: [{ name: 'followers_count', total: 100 }] })
  })

  it('returns unsupported when a read permission was not granted', async () => {
    const service = new ThreadsReadService(provider({ listReplies: vi.fn(async () => { throw new AppError('CAPABILITY_NOT_GRANTED', 'safe', 403) }) }), credentials(validCredential))
    expect(await service.replies('10')).toMatchObject({ status: 'unsupported' })
  })

  it('requires reconnection for missing, expired, or provider-invalid authorization', async () => {
    await expect(new ThreadsReadService(provider(), credentials(null)).posts()).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
    await expect(new ThreadsReadService(provider(), credentials({ accountId: '42', accessToken: '' })).posts()).rejects.toMatchObject({ code: 'AUTHORIZATION_EXPIRED' })
    const service = new ThreadsReadService(provider({ getAccountInsights: vi.fn(async () => { throw new AppError('AUTHORIZATION_EXPIRED', 'Reconnect.', 401) }) }), credentials(validCredential))
    expect(await service.accountInsights()).toMatchObject({ status: 'reauthorization_required', reauthorizationRequired: true })
  })

  it('compares only provider-returned ranged metrics across valid periods', async () => {
    const range = vi.fn()
      .mockResolvedValueOnce([{ name: 'likes', total: 8 }])
      .mockResolvedValueOnce([{ name: 'likes', total: 5 }])
    const service = new ThreadsReadService(provider({ getAccountInsightsRange: range }), credentials(validCredential))
    const result = await service.accountInsightsComparison(7, new Date('2026-09-11T00:00:00Z'))
    expect(result).toMatchObject({ status: 'supported', data: { days: 7, current: { metrics: [{ name: 'likes', total: 8 }] }, previous: { metrics: [{ name: 'likes', total: 5 }] } } })
    expect(range).toHaveBeenCalledTimes(2)
    await expect(service.accountInsightsComparison(1)).rejects.toMatchObject({ code: 'INVALID_PERIOD' })
  })

  it('preserves unavailable comparison metrics as absent', async () => {
    const service = new ThreadsReadService(provider({ getAccountInsightsRange: vi.fn(async () => []) }), credentials(validCredential))
    expect(await service.accountInsightsComparison(7)).toMatchObject({ status: 'empty' })
  })

  it('rejects invalid media IDs and oversized cursors before provider calls', async () => {
    const api = provider()
    const service = new ThreadsReadService(api, credentials(validCredential))
    await expect(service.replies('../secret')).rejects.toMatchObject({ code: 'INVALID_MEDIA_ID' })
    await expect(service.posts('x'.repeat(2049))).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    expect(api.listReplies).not.toHaveBeenCalled()
  })
})
