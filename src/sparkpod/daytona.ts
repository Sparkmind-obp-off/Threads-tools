import { Daytona } from '@daytona/sdk'
import { decryptToken, encryptToken } from '../auth/crypto'

const DEFAULT_API_URL = 'https://app.daytona.io/api'
const DEFAULT_TARGET = 'us'

export interface DaytonaCredentialStatus {
  configured: boolean
  apiUrl?: string
  target?: string
  updatedAt?: string
}

export class DaytonaCredentialStore {
  constructor(private readonly db: D1Database, private readonly sessionSecret: string) {}

  private assertSecret(): void {
    if (!this.sessionSecret || this.sessionSecret.length < 32) throw new Error('A valid session encryption secret is required.')
  }

  async status(): Promise<DaytonaCredentialStatus> {
    const row = await this.db.prepare(
      'SELECT api_url, target, updated_at FROM sparkpod_daytona_credentials WHERE id = 1',
    ).first<{ api_url: string; target: string; updated_at: string }>()
    if (!row) return { configured: false }
    return { configured: true, apiUrl: row.api_url, target: row.target, updatedAt: row.updated_at }
  }

  async save(apiKey: string, apiUrl = DEFAULT_API_URL, target = DEFAULT_TARGET): Promise<void> {
    this.assertSecret()
    const normalizedKey = apiKey.trim()
    if (normalizedKey.length < 20 || normalizedKey.length > 1024) throw new Error('Daytona API key is invalid.')
    const normalizedUrl = apiUrl.trim() || DEFAULT_API_URL
    const parsed = new URL(normalizedUrl)
    if (parsed.protocol !== 'https:') throw new Error('Daytona API URL must use HTTPS.')
    if (target !== 'us' && target !== 'eu') throw new Error('Daytona target must be us or eu.')

    const now = new Date().toISOString()
    const encrypted = await encryptToken(normalizedKey, this.sessionSecret)
    await this.db.prepare(`
      INSERT INTO sparkpod_daytona_credentials (id, encrypted_api_key, api_url, target, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        encrypted_api_key = excluded.encrypted_api_key,
        api_url = excluded.api_url,
        target = excluded.target,
        updated_at = excluded.updated_at
    `).bind(encrypted, normalizedUrl.replace(/\/$/, ''), target, now, now).run()
  }

  async remove(): Promise<void> {
    await this.db.prepare('DELETE FROM sparkpod_daytona_credentials WHERE id = 1').run()
  }

  async client(): Promise<Daytona> {
    this.assertSecret()
    const row = await this.db.prepare(
      'SELECT encrypted_api_key, api_url, target FROM sparkpod_daytona_credentials WHERE id = 1',
    ).first<{ encrypted_api_key: string; api_url: string; target: 'us' | 'eu' }>()
    if (!row) throw new Error('Daytona is not connected. Add the Daytona API key first.')
    const apiKey = await decryptToken(row.encrypted_api_key, this.sessionSecret)
    return new Daytona({ apiKey, apiUrl: row.api_url, target: row.target })
  }
}
