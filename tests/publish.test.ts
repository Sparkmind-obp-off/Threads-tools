import { describe, expect, it, vi } from 'vitest'
import { AppError, type PublishRequestState, type PublishResult } from '../src/domain/types'
import { ThreadsPublishService, validatePublishInput } from '../src/services/publish'
import type { CredentialStore, PublishRequestStore } from '../src/storage/repositories'
import type { ThreadsProvider } from '../src/threads/adapter'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

function credentials(value: Awaited<ReturnType<CredentialStore['getCredential']>>): CredentialStore {
  return { getCredential: vi.fn(async () => value) }
}

function provider(overrides: Partial<ThreadsProvider> = {}): ThreadsProvider {
  return {
    authorizationUrl: () => '', exchangeCode: vi.fn(), exchangeLongLived: vi.fn(),
    getAccount: vi.fn(async () => ({ id: '42' })),
    listPosts: vi.fn(async () => ({ status: 'empty', items: [] })),
    listReplies: vi.fn(async () => ({ status: 'empty', items: [] })),
    getPostInsights: vi.fn(async () => []), getAccountInsights: vi.fn(async () => []),
    getAccountInsightsRange: vi.fn(async () => []),
    createTextContainer: vi.fn(async () => 'container-10'),
    publishContainer: vi.fn(async () => 'post-11'),
    getPost: vi.fn(async () => ({ id: 'post-11', permalink: 'https://www.threads.net/@operator/post/abc', timestamp: '2026-09-11T10:00:00+0000' })),
    ...overrides,
  } as ThreadsProvider
}

class MemoryRequests implements PublishRequestStore {
  state: PublishRequestState = { state: 'claimed' }
  published?: PublishResult
  failed = false
  async claim() { return this.state }
  async markPublished(_requestId: string, result: PublishResult) { this.published = result }
  async markFailed() { this.failed = true }
}

const validCredential = { accountId: '42', accessToken: 'server-token' }

function input(text = 'A real Threads post') { return { text, requestId: REQUEST_ID } }

describe('Threads publish validation', () => {
  it('accepts valid text and rejects empty, oversized, malformed, and link-limit input', () => {
    expect(validatePublishInput(input())).toEqual(input())
    expect(() => validatePublishInput(input('   '))).toThrowError(/required/)
    expect(() => validatePublishInput(input('😀'.repeat(126)))).toThrowError(/500-byte/)
    expect(() => validatePublishInput({ text: 'Valid', requestId: 'not-a-uuid' })).toThrowError(/identifier/)
    expect(() => validatePublishInput(input('https://a.test https://b.test https://c.test https://d.test https://e.test https://f.test'))).toThrowError(/5 unique links/)
  })
})

describe('Threads publish service', () => {
  it('requires a connected, non-expired server-side credential', async () => {
    await expect(new ThreadsPublishService(provider(), credentials(null), new MemoryRequests()).publish(input())).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
    await expect(new ThreadsPublishService(provider(), credentials({ accountId: '42', accessToken: '' }), new MemoryRequests()).publish(input())).rejects.toMatchObject({ code: 'AUTHORIZATION_EXPIRED' })
  })

  it('creates a text container, publishes it once, and returns only normalized real fields', async () => {
    const api = provider(); const requests = new MemoryRequests()
    const result = await new ThreadsPublishService(api, credentials(validCredential), requests).publish(input())
    expect(api.createTextContainer).toHaveBeenCalledWith('server-token', '42', 'A real Threads post')
    expect(api.publishContainer).toHaveBeenCalledWith('server-token', '42', 'container-10')
    expect(result).toEqual({ status: 'published', postId: 'post-11', permalink: 'https://www.threads.net/@operator/post/abc', timestamp: '2026-09-11T10:00:00+0000', message: 'Threads accepted and published the post.' })
    expect(JSON.stringify(result)).not.toContain('server-token')
    expect(requests.published).toEqual(result)
  })

  it('does not invent optional publish fields when enrichment is unavailable', async () => {
    const api = provider({ getPost: vi.fn(async () => { throw new AppError('PUBLISHED_POST_LOOKUP_FAILED', 'safe', 502) }) })
    const result = await new ThreadsPublishService(api, credentials(validCredential), new MemoryRequests()).publish(input())
    expect(result).toEqual({ status: 'published', postId: 'post-11', message: 'Threads accepted and published the post.' })
    expect(result).not.toHaveProperty('permalink')
    expect(result).not.toHaveProperty('timestamp')
  })

  it('marks definite container and publish rejections failed', async () => {
    const containerRequests = new MemoryRequests()
    const containerApi = provider({ createTextContainer: vi.fn(async () => { throw new AppError('CONTAINER_CREATION_FAILED', 'safe', 502) }) })
    await expect(new ThreadsPublishService(containerApi, credentials(validCredential), containerRequests).publish(input())).rejects.toMatchObject({ code: 'CONTAINER_CREATION_FAILED' })
    expect(containerRequests.failed).toBe(true)

    const publishRequests = new MemoryRequests()
    const publishApi = provider({ publishContainer: vi.fn(async () => { throw new AppError('PUBLISH_FAILED', 'safe', 502) }) })
    await expect(new ThreadsPublishService(publishApi, credentials(validCredential), publishRequests).publish(input())).rejects.toMatchObject({ code: 'PUBLISH_FAILED' })
    expect(publishRequests.failed).toBe(true)
  })

  it('does not retry or mark failed after an ambiguous publish response', async () => {
    const requests = new MemoryRequests()
    const publish = vi.fn(async () => { throw new AppError('PROVIDER_UNAVAILABLE', 'safe', 503, true) })
    await expect(new ThreadsPublishService(provider({ publishContainer: publish }), credentials(validCredential), requests).publish(input())).rejects.toMatchObject({ code: 'PUBLISH_RESULT_UNCERTAIN', retryable: false })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(requests.failed).toBe(false)
  })

  it('prevents duplicate processing and replays only an already-persisted success', async () => {
    const processing = new MemoryRequests(); processing.state = { state: 'processing' }
    const api = provider()
    await expect(new ThreadsPublishService(api, credentials(validCredential), processing).publish(input())).rejects.toMatchObject({ code: 'DUPLICATE_IN_PROGRESS' })
    expect(api.createTextContainer).not.toHaveBeenCalled()

    const prior: PublishResult = { status: 'published', postId: 'existing-post' }
    const published = new MemoryRequests(); published.state = { state: 'published', result: prior }
    expect(await new ThreadsPublishService(api, credentials(validCredential), published).publish(input())).toEqual(prior)
    expect(api.createTextContainer).not.toHaveBeenCalled()
  })
})
