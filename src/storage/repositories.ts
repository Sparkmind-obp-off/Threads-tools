import type { PublishRequestState, PublishResult, SafeConnection, ThreadsAccount } from '../domain/types'
import { decryptToken, encryptToken, sha256 } from '../auth/crypto'

export interface OAuthStateStore {
  create(state: string, expiresAt: Date): Promise<void>
  consume(state: string, now: Date): Promise<boolean>
}

export interface StoredConnectionInput {
  account: ThreadsAccount
  accessToken: string
  expiresAt?: Date
  connectedAt: Date
}

export interface ConnectionStore {
  save(input: StoredConnectionInput): Promise<void>
  getSafe(): Promise<SafeConnection>
  disconnect(): Promise<void>
}

export interface StoredCredential {
  accountId: string
  accessToken: string
  expiresAt?: Date
}

export interface CredentialStore {
  getCredential(now?: Date): Promise<StoredCredential | null>
}

export interface PublishRequestStore {
  claim(requestId: string, accountId: string, contentHash: string, now?: Date): Promise<PublishRequestState>
  markPublished(requestId: string, result: PublishResult, now?: Date): Promise<void>
  markFailed(requestId: string, now?: Date): Promise<void>
}

export class D1OAuthStateStore implements OAuthStateStore {
  constructor(private readonly db: D1Database) {}

  async create(state: string, expiresAt: Date): Promise<void> {
    await this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(new Date().toISOString()).run()
    await this.db.prepare('INSERT INTO oauth_states (state_hash, expires_at) VALUES (?, ?)')
      .bind(await sha256(state), expiresAt.toISOString()).run()
  }

  async consume(state: string, now: Date): Promise<boolean> {
    const hash = await sha256(state)
    const result = await this.db.prepare(`UPDATE oauth_states SET consumed_at = ?
      WHERE state_hash = ? AND consumed_at IS NULL AND expires_at >= ?`)
      .bind(now.toISOString(), hash, now.toISOString()).run()
    return result.meta.changes === 1
  }
}

export class D1ConnectionStore implements ConnectionStore {
  constructor(private readonly db: D1Database, private readonly secret: string) {}

  async save(input: StoredConnectionInput): Promise<void> {
    const now = input.connectedAt.toISOString()
    const encrypted = await encryptToken(input.accessToken, this.secret)
    await this.db.prepare(`INSERT INTO threads_connections
      (id, account_id, username, display_name, encrypted_access_token, token_expires_at, connected_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, username=excluded.username,
      display_name=excluded.display_name, encrypted_access_token=excluded.encrypted_access_token,
      token_expires_at=excluded.token_expires_at, connected_at=excluded.connected_at, updated_at=excluded.updated_at`)
      .bind(input.account.id, input.account.username ?? null, input.account.name ?? null, encrypted,
        input.expiresAt?.toISOString() ?? null, now, now).run()
  }

  async getSafe(): Promise<SafeConnection> {
    const row = await this.db.prepare(`SELECT account_id, username, display_name, token_expires_at, connected_at
      FROM threads_connections WHERE id = 1`).first<Record<string, string | null>>()
    if (!row) return { status: 'disconnected' }
    return {
      status: 'connected', accountId: row.account_id!, username: row.username ?? undefined,
      displayName: row.display_name ?? undefined, connectedAt: row.connected_at!,
      tokenExpiresAt: row.token_expires_at ?? undefined,
    }
  }

  async getCredential(now = new Date()): Promise<StoredCredential | null> {
    const row = await this.db.prepare(`SELECT account_id, encrypted_access_token, token_expires_at
      FROM threads_connections WHERE id = 1`).first<Record<string, string | null>>()
    if (!row?.account_id || !row.encrypted_access_token) return null
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : undefined
    if (expiresAt && expiresAt.getTime() <= now.getTime()) return { accountId: row.account_id, accessToken: '', expiresAt }
    return {
      accountId: row.account_id,
      accessToken: await decryptToken(row.encrypted_access_token, this.secret),
      expiresAt,
    }
  }

  async disconnect(): Promise<void> { await this.db.prepare('DELETE FROM threads_connections WHERE id = 1').run() }
}

export class D1PublishRequestStore implements PublishRequestStore {
  constructor(private readonly db: D1Database) {}

  async claim(requestId: string, accountId: string, contentHash: string, now = new Date()): Promise<PublishRequestState> {
    const timestamp = now.toISOString()
    await this.db.prepare('DELETE FROM publish_requests WHERE updated_at < ?')
      .bind(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).run()
    const inserted = await this.db.prepare(`INSERT OR IGNORE INTO publish_requests
      (request_id, account_id, content_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'processing', ?, ?)`)
      .bind(requestId, accountId, contentHash, timestamp, timestamp).run()
    if (inserted.meta.changes === 1) return { state: 'claimed' }

    const row = await this.db.prepare(`SELECT account_id, content_hash, status, result_json
      FROM publish_requests WHERE request_id = ?`).bind(requestId).first<Record<string, string | null>>()
    if (!row || row.account_id !== accountId || row.content_hash !== contentHash) return { state: 'failed' }
    if (row.status === 'processing') return { state: 'processing' }
    if (row.status === 'published' && row.result_json) {
      try {
        const result = JSON.parse(row.result_json) as PublishResult
        if (result.status === 'published' && typeof result.postId === 'string') return { state: 'published', result }
      } catch { /* treat malformed persisted output as failed */ }
    }
    return { state: 'failed' }
  }

  async markPublished(requestId: string, result: PublishResult, now = new Date()): Promise<void> {
    await this.db.prepare(`UPDATE publish_requests SET status = 'published', result_json = ?, updated_at = ?
      WHERE request_id = ? AND status = 'processing'`)
      .bind(JSON.stringify(result), now.toISOString(), requestId).run()
  }

  async markFailed(requestId: string, now = new Date()): Promise<void> {
    await this.db.prepare(`UPDATE publish_requests SET status = 'failed', updated_at = ?
      WHERE request_id = ? AND status = 'processing'`)
      .bind(now.toISOString(), requestId).run()
  }
}
