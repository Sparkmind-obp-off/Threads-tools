import { describe, expect, it, vi } from 'vitest'
import { OAuthService } from '../src/services/oauth'
import type { ConnectionStore, OAuthStateStore, StoredConnectionInput } from '../src/storage/repositories'
import type { ThreadsProvider, TokenResult } from '../src/threads/adapter'
import type { SafeConnection, ThreadsAccount } from '../src/domain/types'

class MemoryStates implements OAuthStateStore {
  states = new Map<string, Date>()
  async create(state: string, expiresAt: Date) { this.states.set(state, expiresAt) }
  async consume(state: string, now: Date) {
    const expires = this.states.get(state); this.states.delete(state)
    return Boolean(expires && expires >= now)
  }
}

class MemoryConnections implements ConnectionStore {
  saved?: StoredConnectionInput
  async save(input: StoredConnectionInput) { this.saved = input }
  async getSafe(): Promise<SafeConnection> {
    if (!this.saved) return { status: 'disconnected' }
    return { status: 'connected', accountId: this.saved.account.id, username: this.saved.account.username, displayName: this.saved.account.name, connectedAt: this.saved.connectedAt.toISOString() }
  }
  async disconnect() { this.saved = undefined }
}

function provider(overrides: Partial<ThreadsProvider> = {}): ThreadsProvider {
  return {
    authorizationUrl: (state) => `https://threads.com/oauth/authorize?state=${state}`,
    exchangeCode: vi.fn(async (): Promise<TokenResult> => ({ accessToken: 'short-secret', userId: '42' })),
    exchangeLongLived: vi.fn(async (): Promise<TokenResult> => ({ accessToken: 'long-secret', userId: '42', expiresIn: 3600 })),
    getAccount: vi.fn(async (): Promise<ThreadsAccount> => ({ id: '42', username: 'operator', name: 'Operator' })),
    listPosts: vi.fn(async () => ({ status: 'empty' as const, items: [] })),
    listReplies: vi.fn(async () => ({ status: 'empty' as const, items: [] })),
    getPostInsights: vi.fn(async () => []),
    getAccountInsights: vi.fn(async () => []),
    ...overrides,
  }
}

async function readyService(overrides: Partial<ThreadsProvider> = {}) {
  const states = new MemoryStates(); const connections = new MemoryConnections()
  const service = new OAuthService(provider(overrides), states, connections, () => new Date('2026-09-11T10:00:00Z'))
  const start = await service.start()
  const state = new URL(start.authorizationUrl).searchParams.get('state')!
  return { service, states, connections, state }
}

describe('OAuth state and callback', () => {
  it('generates a cryptographically sized, single-use state', async () => {
    const { states, state } = await readyService()
    expect(state.length).toBeGreaterThan(40)
    expect(await states.consume(state, new Date('2026-09-11T10:00:00Z'))).toBe(true)
    expect(await states.consume(state, new Date('2026-09-11T10:00:00Z'))).toBe(false)
  })

  it('completes token exchange, account lookup, and safe normalization', async () => {
    const { service, connections, state } = await readyService()
    const result = await service.callback({ state, code: 'authorization-code' })
    expect(result).toMatchObject({ status: 'connected', accountId: '42', username: 'operator', displayName: 'Operator' })
    expect(connections.saved?.accessToken).toBe('long-secret')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(result).not.toHaveProperty('accessToken')
  })

  it('rejects invalid OAuth state before provider calls', async () => {
    const exchangeCode = vi.fn()
    const { service } = await readyService({ exchangeCode })
    await expect(service.callback({ state: 'forged', code: 'code' })).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' })
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('normalizes provider authorization denial', async () => {
    const { service, state } = await readyService()
    await expect(service.callback({ state, error: 'access_denied' })).rejects.toMatchObject({ code: 'OAUTH_CANCELLED' })
  })

  it('propagates token exchange failure without saving credentials', async () => {
    const { service, connections, state } = await readyService({ exchangeCode: vi.fn(async () => { throw Object.assign(new Error('safe'), { code: 'TOKEN_EXCHANGE_FAILED' }) }) })
    await expect(service.callback({ state, code: 'code' })).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' })
    expect(connections.saved).toBeUndefined()
  })

  it('propagates account lookup failure without saving credentials', async () => {
    const { service, connections, state } = await readyService({ getAccount: vi.fn(async () => { throw Object.assign(new Error('safe'), { code: 'ACCOUNT_LOOKUP_FAILED' }) }) })
    await expect(service.callback({ state, code: 'code' })).rejects.toMatchObject({ code: 'ACCOUNT_LOOKUP_FAILED' })
    expect(connections.saved).toBeUndefined()
  })
})
