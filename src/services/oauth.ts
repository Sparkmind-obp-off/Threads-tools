import { AppError, type SafeConnection } from '../domain/types'
import type { ThreadsProvider } from '../threads/adapter'
import type { AuditStore, ConnectionStore, OAuthStateStore } from '../storage/repositories'
import { randomState } from '../auth/crypto'

export interface CallbackInput { state?: string; code?: string; error?: string; errorDescription?: string }

export class OAuthService {
  constructor(
    private readonly provider: ThreadsProvider,
    private readonly states: OAuthStateStore,
    private readonly connections: ConnectionStore,
    private readonly now: () => Date = () => new Date(),
    private readonly audit?: AuditStore,
  ) {}

  async start(): Promise<{ authorizationUrl: string }> {
    const state = randomState()
    await this.states.create(state, new Date(this.now().getTime() + 10 * 60 * 1000))
    return { authorizationUrl: this.provider.authorizationUrl(state) }
  }

  async callback(input: CallbackInput): Promise<SafeConnection> {
    if (!input.state || !(await this.states.consume(input.state, this.now()))) {
      throw new AppError('OAUTH_STATE_INVALID', 'The connection request expired or could not be verified. Please try again.', 400)
    }
    if (input.error) {
      if (input.error === 'access_denied') throw new AppError('OAUTH_CANCELLED', 'Threads authorization was cancelled.', 400)
      throw new AppError('AUTHORIZATION_FAILED', 'Threads did not authorize this connection.', 400)
    }
    if (!input.code || input.code.length > 2048) {
      throw new AppError('AUTHORIZATION_FAILED', 'Threads did not return a valid authorization result.', 400)
    }
    const shortLived = await this.provider.exchangeCode(input.code)
    const token = await this.provider.exchangeLongLived(shortLived.accessToken, shortLived.userId)
    const account = await this.provider.getAccount(token.accessToken)
    if (account.id !== token.userId) throw new AppError('ACCOUNT_LOOKUP_FAILED', 'Threads returned an unexpected account identity.', 502)
    const connectedAt = this.now()
    const expiresAt = token.expiresIn ? new Date(connectedAt.getTime() + token.expiresIn * 1000) : undefined
    await this.connections.save({ account, accessToken: token.accessToken, expiresAt, connectedAt })
    await this.audit?.record('oauth_connected', 'success', account.id, undefined, connectedAt).catch(() => undefined)
    return this.connections.getSafe()
  }
}
