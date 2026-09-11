import { AppError, type ThreadsAccount } from '../domain/types'
import type { AppConfig } from '../config/env'

export interface TokenResult { accessToken: string; userId: string; expiresIn?: number }
export interface ThreadsProvider {
  authorizationUrl(state: string): string
  exchangeCode(code: string): Promise<TokenResult>
  exchangeLongLived(shortLivedToken: string, userId: string): Promise<TokenResult>
  getAccount(accessToken: string): Promise<ThreadsAccount>
}

interface ProviderErrorPayload {
  error?: { message?: string; type?: string; code?: number }
  error_message?: string
  error_type?: string
  code?: number
}

export class MetaThreadsProvider implements ThreadsProvider {
  constructor(private readonly config: AppConfig, private readonly fetcher: typeof fetch = fetch) {}

  authorizationUrl(state: string): string {
    const url = new URL('https://threads.com/oauth/authorize')
    url.searchParams.set('client_id', this.config.threadsAppId)
    url.searchParams.set('redirect_uri', this.config.threadsRedirectUri)
    url.searchParams.set('scope', 'threads_basic')
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
    const url = new URL(`${this.config.threadsApiBaseUrl}/${this.config.threadsApiVersion}/me`)
    url.searchParams.set('fields', 'id,username,name')
    url.searchParams.set('access_token', accessToken)
    const response = await this.fetcher(url, { method: 'GET' })
    const payload = await this.readPayload(response, 'ACCOUNT_LOOKUP_FAILED', 'The connected Threads account could not be identified.')
    if (typeof payload.id !== 'string' && typeof payload.id !== 'number') {
      throw new AppError('ACCOUNT_LOOKUP_FAILED', 'Threads returned incomplete account information.', 502)
    }
    return {
      id: String(payload.id),
      username: typeof payload.username === 'string' ? payload.username : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    }
  }

  private async readPayload(response: Response, code: string, message: string): Promise<Record<string, unknown>> {
    let payload: Record<string, unknown> = {}
    try { payload = await response.json() as Record<string, unknown> } catch { /* safe fallback */ }
    if (!response.ok) {
      const error = payload as ProviderErrorPayload
      const providerCode = error.error?.code ?? error.code
      const suffix = providerCode ? ` (provider code ${providerCode})` : ''
      throw new AppError(code, `${message}${suffix}`, response.status >= 500 ? 503 : 502, response.status >= 500 || response.status === 429)
    }
    return payload
  }
}
