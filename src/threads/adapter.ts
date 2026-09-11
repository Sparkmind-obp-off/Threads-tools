import { AppError, type InsightMetric, type PageResult, type ThreadsAccount, type ThreadsPost, type ThreadsReply } from '../domain/types'
import type { AppConfig } from '../config/env'
import { normalizeAccount, normalizeInsights, normalizePage, normalizePost, normalizeReply } from './normalizers'

export interface TokenResult { accessToken: string; userId: string; expiresIn?: number }
export interface ThreadsProvider {
  authorizationUrl(state: string): string
  exchangeCode(code: string): Promise<TokenResult>
  exchangeLongLived(shortLivedToken: string, userId: string): Promise<TokenResult>
  getAccount(accessToken: string): Promise<ThreadsAccount>
  listPosts(accessToken: string, cursor?: string, limit?: number): Promise<PageResult<ThreadsPost>>
  listReplies(accessToken: string, mediaId: string, cursor?: string, limit?: number): Promise<PageResult<ThreadsReply>>
  getPostInsights(accessToken: string, mediaId: string): Promise<InsightMetric[]>
  getAccountInsights(accessToken: string, userId: string): Promise<InsightMetric[]>
}

interface ProviderErrorPayload {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number }
  error_message?: string
  error_type?: string
  code?: number
}

const ACCOUNT_FIELDS = 'id,username,name,threads_profile_picture_url,threads_biography,is_verified'
const POST_FIELDS = 'id,media_product_type,media_type,media_url,permalink,username,text,timestamp,shortcode,thumbnail_url,is_quote_post,quoted_post,reposted_post,alt_text,link_attachment_url,gif_url,topic_tag'
const REPLY_FIELDS = 'id,media_product_type,media_type,media_url,permalink,username,text,timestamp,shortcode,thumbnail_url,is_quote_post,quoted_post,gif_url,topic_tag,has_replies,root_post,replied_to,is_reply,is_reply_owned_by_me,hide_status,is_verified,profile_picture_url'
const POST_METRICS = 'views,likes,replies,reposts,quotes,shares'
const ACCOUNT_METRICS = 'views,likes,replies,reposts,quotes,clicks,followers_count'

export class MetaThreadsProvider implements ThreadsProvider {
  constructor(private readonly config: AppConfig, private readonly fetcher: typeof fetch = fetch) {}

  authorizationUrl(state: string): string {
    const url = new URL('https://threads.com/oauth/authorize')
    url.searchParams.set('client_id', this.config.threadsAppId)
    url.searchParams.set('redirect_uri', this.config.threadsRedirectUri)
    url.searchParams.set('scope', 'threads_basic,threads_read_replies,threads_manage_insights')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    return url.toString()
  }

  async exchangeCode(code: string): Promise<TokenResult> {
    const body = new FormData()
    body.set('client_id', this.config.threadsAppId)
    body.set('client_secret', this.config.threadsAppSecret)
    body.set('grant_type', 'authorization_code')
    body.set('redirect_uri', this.config.threadsRedirectUri)
    body.set('code', code)
    const response = await this.fetcher(`${this.config.threadsApiBaseUrl}/oauth/access_token`, { method: 'POST', body })
    const payload = await this.readPayload(response, 'TOKEN_EXCHANGE_FAILED', 'Threads authorization could not be completed.')
    if (typeof payload.access_token !== 'string' || !payload.access_token || (!payload.user_id && payload.user_id !== 0)) {
      throw new AppError('TOKEN_EXCHANGE_FAILED', 'Threads returned an incomplete authorization response.', 502)
    }
    return { accessToken: payload.access_token, userId: String(payload.user_id) }
  }

  async exchangeLongLived(shortLivedToken: string, userId: string): Promise<TokenResult> {
    const url = new URL(`${this.config.threadsApiBaseUrl}/access_token`)
    url.searchParams.set('grant_type', 'th_exchange_token')
    url.searchParams.set('client_secret', this.config.threadsAppSecret)
    url.searchParams.set('access_token', shortLivedToken)
    const response = await this.fetcher(url, { method: 'GET' })
    const payload = await this.readPayload(response, 'TOKEN_EXCHANGE_FAILED', 'Threads long-lived access could not be established.')
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new AppError('TOKEN_EXCHANGE_FAILED', 'Threads returned an incomplete long-lived token response.', 502)
    }
    return { accessToken: payload.access_token, userId, expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : undefined }
  }

  async getAccount(accessToken: string): Promise<ThreadsAccount> {
    const payload = await this.get(`me`, accessToken, { fields: ACCOUNT_FIELDS }, 'ACCOUNT_LOOKUP_FAILED', 'The connected Threads account could not be read.')
    return normalizeAccount(payload)
  }

  async listPosts(accessToken: string, cursor?: string, limit = 12): Promise<PageResult<ThreadsPost>> {
    const payload = await this.get('me/threads', accessToken, { fields: POST_FIELDS, limit: String(this.limit(limit)), after: cursor }, 'POSTS_READ_FAILED', 'Threads posts could not be loaded.')
    const page = normalizePage(payload, normalizePost)
    return { status: page.items.length ? 'supported' : 'empty', items: page.items, nextCursor: page.nextCursor }
  }

  async listReplies(accessToken: string, mediaId: string, cursor?: string, limit = 25): Promise<PageResult<ThreadsReply>> {
    const payload = await this.get(`${encodeURIComponent(mediaId)}/replies`, accessToken, { fields: REPLY_FIELDS, reverse: 'true', limit: String(this.limit(limit)), after: cursor }, 'REPLIES_READ_FAILED', 'Replies could not be loaded.')
    const page = normalizePage(payload, normalizeReply)
    return { status: page.items.length ? 'supported' : 'empty', items: page.items, nextCursor: page.nextCursor }
  }

  async getPostInsights(accessToken: string, mediaId: string): Promise<InsightMetric[]> {
    const payload = await this.get(`${encodeURIComponent(mediaId)}/insights`, accessToken, { metric: POST_METRICS }, 'INSIGHTS_READ_FAILED', 'Post insights could not be loaded.')
    return normalizeInsights(payload)
  }

  async getAccountInsights(accessToken: string, userId: string): Promise<InsightMetric[]> {
    const payload = await this.get(`${encodeURIComponent(userId)}/threads_insights`, accessToken, { metric: ACCOUNT_METRICS }, 'INSIGHTS_READ_FAILED', 'Account insights could not be loaded.')
    return normalizeInsights(payload)
  }

  private async get(path: string, accessToken: string, params: Record<string, string | undefined>, code: string, message: string): Promise<Record<string, unknown>> {
    const url = new URL(`${this.config.threadsApiBaseUrl}/${this.config.threadsApiVersion}/${path}`)
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value)
    const response = await this.fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } })
    return this.readPayload(response, code, message)
  }

  private limit(value: number): number {
    if (!Number.isInteger(value) || value < 1) return 12
    return Math.min(value, 100)
  }

  private async readPayload(response: Response, code: string, message: string): Promise<Record<string, unknown>> {
    let payload: Record<string, unknown> = {}
    try { payload = await response.json() as Record<string, unknown> } catch { /* safe fallback */ }
    if (!response.ok) {
      const error = payload as ProviderErrorPayload
      const providerCode = error.error?.code ?? error.code
      if (response.status === 401 || providerCode === 190) {
        throw new AppError('AUTHORIZATION_EXPIRED', 'Threads authorization is invalid or expired. Reconnect the account.', 401)
      }
      if (response.status === 403 || providerCode === 10 || providerCode === 200) {
        throw new AppError('CAPABILITY_NOT_GRANTED', 'The connected account has not granted the required Threads permission. Reconnect and approve the requested read permission.', 403)
      }
      const suffix = providerCode ? ` (provider code ${providerCode})` : ''
      throw new AppError(code, `${message}${suffix}`, response.status >= 500 ? 503 : 502, response.status >= 500 || response.status === 429)
    }
    return payload
  }
}
