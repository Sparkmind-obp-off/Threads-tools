import { sha256 } from '../auth/crypto'
import { AppError, type PublishInput, type PublishResult } from '../domain/types'
import type { AuditStore, CredentialStore, PublishRequestStore } from '../storage/repositories'
import type { ThreadsProvider } from '../threads/adapter'

export const THREADS_TEXT_MAX_BYTES = 500
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi

export function validatePublishInput(value: unknown): PublishInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', 'Publish data must be a valid object.', 400)
  }
  const input = value as Record<string, unknown>
  if (typeof input.text !== 'string' || !input.text.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Post text is required.', 400)
  }
  const bytes = new TextEncoder().encode(input.text).length
  if (bytes > THREADS_TEXT_MAX_BYTES) {
    throw new AppError('VALIDATION_FAILED', `Post text exceeds the ${THREADS_TEXT_MAX_BYTES}-byte Threads limit.`, 400)
  }
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
    throw new AppError('VALIDATION_FAILED', 'A valid publish request identifier is required.', 400)
  }
  const links = new Set(input.text.match(URL_PATTERN) ?? [])
  if (links.size > 5) {
    throw new AppError('VALIDATION_FAILED', 'Threads allows no more than 5 unique links in a post.', 400)
  }
  return { text: input.text, requestId: input.requestId }
}

export class ThreadsPublishService {
  constructor(
    private readonly provider: ThreadsProvider,
    private readonly credentials: CredentialStore,
    private readonly requests: PublishRequestStore,
    private readonly audit?: AuditStore,
  ) {}

  async publish(value: unknown): Promise<PublishResult> {
    const input = validatePublishInput(value)
    const credential = await this.requireCredential()
    const contentHash = await sha256(input.text)
    const claim = await this.requests.claim(input.requestId, credential.accountId, contentHash)
    if (claim.state === 'published') return claim.result
    if (claim.state === 'processing') {
      throw new AppError('DUPLICATE_IN_PROGRESS', 'This publish request is already processing. Check Posts before trying again.', 409)
    }
    if (claim.state !== 'claimed') {
      throw new AppError('DUPLICATE_REQUEST', 'This publish request was already used. Review the result before starting a new publish.', 409)
    }
    await this.audit?.record('publish_attempt', 'started').catch(() => undefined)

    let containerId: string
    try {
      containerId = await this.provider.createTextContainer(credential.accessToken, credential.accountId, input.text)
    } catch (error) {
      await this.requests.markFailed(input.requestId)
      await this.audit?.record('publish_failed', 'failure', undefined, error instanceof AppError ? error.code : 'CONTAINER_CREATION_FAILED').catch(() => undefined)
      if (error instanceof AppError) throw error
      throw new AppError('CONTAINER_CREATION_FAILED', 'Threads could not prepare this post. No publish retry was attempted automatically.', 502, true)
    }

    let postId: string
    try {
      postId = await this.provider.publishContainer(credential.accessToken, credential.accountId, containerId)
    } catch (error) {
      const definiteRejection = error instanceof AppError && (
        error.status < 500 || ['PUBLISH_FAILED', 'CAPABILITY_NOT_GRANTED', 'RATE_LIMITED', 'AUTHORIZATION_EXPIRED'].includes(error.code)
      )
      if (definiteRejection) {
        await this.requests.markFailed(input.requestId)
        await this.audit?.record('publish_failed', 'failure', undefined, error.code).catch(() => undefined)
        throw error
      }
      await this.audit?.record('publish_failed', 'failure', undefined, 'PUBLISH_RESULT_UNCERTAIN').catch(() => undefined)
      throw new AppError('PUBLISH_RESULT_UNCERTAIN', 'Threads did not return a conclusive publish result. Do not publish again automatically; check Posts first.', 503, false)
    }

    const result: PublishResult = { status: 'published', postId, message: 'Threads accepted and published the post.' }
    try {
      const published = await this.provider.getPost(credential.accessToken, postId)
      if (published.permalink) result.permalink = published.permalink
      if (published.timestamp) result.timestamp = published.timestamp
    } catch { /* The publish ID is authoritative; optional enrichment may not be immediately available. */ }

    try {
      await this.requests.markPublished(input.requestId, result)
      await this.audit?.record('publish_succeeded', 'success', postId).catch(() => undefined)
    } catch {
      throw new AppError('PUBLISH_RESULT_UNCERTAIN', 'Threads published the post, but the application could not persist the result. Check Posts before trying again.', 503, false)
    }
    return result
  }

  private async requireCredential(): Promise<{ accountId: string; accessToken: string }> {
    const credential = await this.credentials.getCredential()
    if (!credential) throw new AppError('NOT_CONNECTED', 'Connect a Threads account before publishing.', 409)
    if (!credential.accessToken) throw new AppError('AUTHORIZATION_EXPIRED', 'Threads authorization has expired. Reconnect the account.', 401)
    return credential
  }
}
