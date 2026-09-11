import type { SafeConnection, ThreadsAccount } from '../domain/types'
import { encryptToken, sha256 } from '../auth/crypto'

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

  async disconnect(): Promise<void> { await this.db.prepare('DELETE FROM threads_connections WHERE id = 1').run() }
}
