import { AppError, type CapabilityResult, type InsightMetric, type PageResult, type ThreadsAccount, type ThreadsPost, type ThreadsReply } from '../domain/types'
import type { CredentialStore } from '../storage/repositories'
import type { ThreadsProvider } from '../threads/adapter'

export class ThreadsReadService {
  constructor(
    private readonly provider: ThreadsProvider,
    private readonly credentials: CredentialStore,
  ) {}

  async account(): Promise<ThreadsAccount> {
    const credential = await this.requireCredential()
    return this.provider.getAccount(credential.accessToken)
  }

  async posts(cursor?: string, limit?: number): Promise<PageResult<ThreadsPost>> {
    const credential = await this.requireCredential()
    return this.provider.listPosts(credential.accessToken, this.cursor(cursor), limit)
  }

  async replies(mediaId: string, cursor?: string, limit?: number): Promise<CapabilityResult<PageResult<ThreadsReply>>> {
    this.mediaId(mediaId)
    const credential = await this.requireCredential()
    try {
      return { status: 'supported', data: await this.provider.listReplies(credential.accessToken, mediaId, this.cursor(cursor), limit) }
    } catch (error) {
      return this.capabilityError(error, 'Replies require the threads_read_replies permission. Reconnect and approve it if available for this app.')
    }
  }

  async accountInsights(): Promise<CapabilityResult<InsightMetric[]>> {
    const credential = await this.requireCredential()
    try {
      const metrics = await this.provider.getAccountInsights(credential.accessToken, credential.accountId)
      return { status: metrics.length ? 'supported' : 'empty', data: metrics }
    } catch (error) {
      return this.capabilityError(error, 'Insights require the threads_manage_insights permission and may require Meta App Review.')
    }
  }

  async postInsights(mediaId: string): Promise<CapabilityResult<InsightMetric[]>> {
    this.mediaId(mediaId)
    const credential = await this.requireCredential()
    try {
      const metrics = await this.provider.getPostInsights(credential.accessToken, mediaId)
      return { status: metrics.length ? 'supported' : 'empty', data: metrics }
    } catch (error) {
      return this.capabilityError(error, 'Post insights require the threads_manage_insights permission. Repost facades can return no metrics.')
    }
  }

  private async requireCredential(): Promise<{ accountId: string; accessToken: string }> {
    const credential = await this.credentials.getCredential()
    if (!credential) throw new AppError('NOT_CONNECTED', 'Connect a Threads account before loading provider data.', 409)
    if (!credential.accessToken) throw new AppError('AUTHORIZATION_EXPIRED', 'Threads authorization has expired. Reconnect the account.', 401)
    return credential
  }

  private cursor(value?: string): string | undefined {
    if (!value) return undefined
    if (value.length > 2048) throw new AppError('INVALID_CURSOR', 'The pagination cursor is invalid.', 400)
    return value
  }

  private mediaId(value: string): void {
    if (!/^\d{1,64}$/.test(value)) throw new AppError('INVALID_MEDIA_ID', 'The Threads media ID is invalid.', 400)
  }

  private capabilityError(error: unknown, fallback: string): CapabilityResult<never> {
    if (error instanceof AppError && error.code === 'CAPABILITY_NOT_GRANTED') {
      return { status: 'unsupported', message: fallback }
    }
    if (error instanceof AppError && error.code === 'AUTHORIZATION_EXPIRED') {
      return { status: 'error', message: error.message, reauthorizationRequired: true }
    }
    if (error instanceof AppError) return { status: 'error', message: error.message }
    throw error
  }
}
