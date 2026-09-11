import { randomState, sha256, encryptToken, decryptToken } from '../auth/crypto'
import { AppError } from '../domain/types'

export const CLOUDFLARE_OAUTH_AUTHORIZATION_URL = 'https://dash.cloudflare.com/oauth2/auth' as const
export const CLOUDFLARE_OAUTH_TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token' as const

export interface CloudflareOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
}

export interface CloudflareOAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scope?: string
}

export interface SafeCloudflareConnection {
  status: 'connected' | 'not_connected' | 'expired'
  accountId?: string
  accountName?: string
  projectName?: string
  expiresAt?: string
}

export interface CloudflareOAuthCredential extends CloudflareOAuthTokens {
  accountId?: string
  accountName?: string
  projectName?: string
}

export interface CloudflareOAuthStore {
  createState(state: string, expiresAt: Date): Promise<void>
  consumeState(state: string, now: Date): Promise<boolean>
  saveCredential(tokens: CloudflareOAuthTokens, now: Date): Promise<void>
  getCredential(): Promise<CloudflareOAuthCredential | null>
  selectProject(accountId: string, accountName: string, projectName: string, now: Date): Promise<void>
  safeStatus(now: Date): Promise<SafeCloudflareConnection>
  disconnect(): Promise<void>
}

export class D1CloudflareOAuthStore implements CloudflareOAuthStore {
  constructor(private readonly db: D1Database, private readonly encryptionSecret: string) {}

  async createState(state: string, expiresAt: Date): Promise<void> {
    const now = new Date().toISOString()
    await this.db.prepare('DELETE FROM cloudflare_oauth_states WHERE expires_at < ? OR consumed_at IS NOT NULL').bind(now).run()
    await this.db.prepare('INSERT INTO cloudflare_oauth_states (state_hash, expires_at) VALUES (?, ?)')
      .bind(await sha256(state), expiresAt.toISOString()).run()
  }

  async consumeState(state: string, now: Date): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE cloudflare_oauth_states SET consumed_at = ?
      WHERE state_hash = ? AND consumed_at IS NULL AND expires_at >= ?`)
      .bind(now.toISOString(), await sha256(state), now.toISOString()).run()
    return result.meta.changes === 1
  }

  async saveCredential(tokens: CloudflareOAuthTokens, now: Date): Promise<void> {
    const encryptedAccess = await encryptToken(tokens.accessToken, this.encryptionSecret)
    const encryptedRefresh = tokens.refreshToken ? await encryptToken(tokens.refreshToken, this.encryptionSecret) : null
    await this.db.prepare(`INSERT INTO cloudflare_oauth_connection
      (id, encrypted_access_token, encrypted_refresh_token, token_expires_at, granted_scope, connected_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET encrypted_access_token=excluded.encrypted_access_token,
      encrypted_refresh_token=excluded.encrypted_refresh_token, token_expires_at=excluded.token_expires_at,
      granted_scope=excluded.granted_scope, account_id=NULL, account_name=NULL, project_name=NULL, updated_at=excluded.updated_at`)
      .bind(encryptedAccess, encryptedRefresh, tokens.expiresAt?.toISOString() ?? null, tokens.scope ?? null, now.toISOString(), now.toISOString()).run()
  }

  async getCredential(): Promise<CloudflareOAuthCredential | null> {
    const row = await this.db.prepare(`SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at,
      granted_scope, account_id, account_name, project_name FROM cloudflare_oauth_connection WHERE id = 1`)
      .first<Record<string, string | null>>()
    if (!row?.encrypted_access_token) return null
    return {
      accessToken: await decryptToken(row.encrypted_access_token, this.encryptionSecret),
      ...(row.encrypted_refresh_token ? { refreshToken: await decryptToken(row.encrypted_refresh_token, this.encryptionSecret) } : {}),
      ...(row.token_expires_at ? { expiresAt: new Date(row.token_expires_at) } : {}),
      ...(row.granted_scope ? { scope: row.granted_scope } : {}),
      ...(row.account_id ? { accountId: row.account_id } : {}),
      ...(row.account_name ? { accountName: row.account_name } : {}),
      ...(row.project_name ? { projectName: row.project_name } : {}),
    }
  }

  async selectProject(accountId: string, accountName: string, projectName: string, now: Date): Promise<void> {
    const result = await this.db.prepare(`UPDATE cloudflare_oauth_connection SET account_id=?, account_name=?, project_name=?, updated_at=? WHERE id=1`)
      .bind(accountId, accountName, projectName, now.toISOString()).run()
    if (result.meta.changes !== 1) throw new AppError('CLOUDFLARE_NOT_CONNECTED', 'Connect Cloudflare before selecting a project.', 409)
  }

  async safeStatus(now: Date): Promise<SafeCloudflareConnection> {
    const credential = await this.getCredential()
    if (!credential) return { status: 'not_connected' }
    const expired = credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()
    return {
      status: expired ? 'expired' : 'connected',
      ...(credential.accountId ? { accountId: credential.accountId } : {}),
      ...(credential.accountName ? { accountName: credential.accountName } : {}),
      ...(credential.projectName ? { projectName: credential.projectName } : {}),
      ...(credential.expiresAt ? { expiresAt: credential.expiresAt.toISOString() } : {}),
    }
  }

  async disconnect(): Promise<void> {
    await this.db.prepare('DELETE FROM cloudflare_oauth_connection WHERE id=1').run()
    await this.db.prepare('DELETE FROM cloudflare_oauth_states').run()
  }
}

function parseTokenResponse(value: unknown, now: Date): CloudflareOAuthTokens {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (typeof body.access_token !== 'string' || !body.access_token) throw new AppError('CLOUDFLARE_TOKEN_EXCHANGE_FAILED', 'Cloudflare did not return a valid access credential.', 502)
  const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) ? Math.max(0, body.expires_in) : undefined
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === 'string' && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(expiresIn !== undefined ? { expiresAt: new Date(now.getTime() + expiresIn * 1000) } : {}),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  }
}

export class CloudflareOAuthClient {
  constructor(private readonly config: CloudflareOAuthConfig, private readonly fetcher: typeof fetch = fetch) {}

  authorizationUrl(state: string): string {
    const url = new URL(CLOUDFLARE_OAUTH_AUTHORIZATION_URL)
    url.search = new URLSearchParams({
      response_type: 'code', client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '), state,
    }).toString()
    return url.toString()
  }

  async exchangeCode(code: string, now = new Date()): Promise<CloudflareOAuthTokens> {
    if (!code.trim()) throw new AppError('CLOUDFLARE_CODE_INVALID', 'Cloudflare authorization code is missing.', 400)
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri })
    const response = await this.fetcher(CLOUDFLARE_OAUTH_TOKEN_URL, {
      method: 'POST', headers: {
        Authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }, body,
    })
    if (!response.ok) throw new AppError('CLOUDFLARE_TOKEN_EXCHANGE_FAILED', 'Cloudflare authorization could not be completed.', 502)
    return parseTokenResponse(await response.json(), now)
  }
}

export class CloudflareOAuthService {
  constructor(
    private readonly client: CloudflareOAuthClient,
    private readonly store: CloudflareOAuthStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(): Promise<string> {
    const state = randomState()
    const now = this.now()
    await this.store.createState(state, new Date(now.getTime() + 10 * 60 * 1000))
    return this.client.authorizationUrl(state)
  }

  async callback(input: { state?: string; code?: string; error?: string }): Promise<void> {
    if (input.error) throw new AppError('CLOUDFLARE_OAUTH_CANCELLED', 'Cloudflare authorization was cancelled.', 400)
    if (!input.state || !await this.store.consumeState(input.state, this.now())) throw new AppError('CLOUDFLARE_STATE_INVALID', 'Cloudflare authorization state is invalid or expired.', 400)
    if (!input.code) throw new AppError('CLOUDFLARE_CODE_INVALID', 'Cloudflare authorization code is missing.', 400)
    const now = this.now()
    await this.store.saveCredential(await this.client.exchangeCode(input.code, now), now)
  }
}
