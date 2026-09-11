export type ConnectionStatus = 'connected' | 'disconnected' | 'not_configured' | 'error'
export type CapabilityStatus = 'supported' | 'unsupported' | 'not_configured' | 'error'

export interface SafeConnection {
  status: ConnectionStatus
  accountId?: string
  username?: string
  displayName?: string
  connectedAt?: string
  tokenExpiresAt?: string
  errorCode?: string
  errorMessage?: string
}

export interface ThreadsAccount {
  id: string
  username?: string
  name?: string
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
