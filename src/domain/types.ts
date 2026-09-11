export type ConnectionStatus = 'connected' | 'disconnected' | 'not_configured' | 'error'
export type CapabilityStatus = 'supported' | 'unsupported' | 'not_configured' | 'empty' | 'error' | 'reauthorization_required'

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
  profilePictureUrl?: string
  biography?: string
  isVerified?: boolean
}

export interface ThreadsPost {
  id: string
  text?: string
  timestamp?: string
  permalink?: string
  mediaType?: string
  mediaUrl?: string
  thumbnailUrl?: string
  username?: string
  shortcode?: string
  topicTag?: string
  altText?: string
  linkAttachmentUrl?: string
  gifUrl?: string
  isQuotePost?: boolean
  quotedPostId?: string
  repostedPostId?: string
}

export interface ThreadsReply extends ThreadsPost {
  hasReplies?: boolean
  isReply?: boolean
  isOwnedByMe?: boolean
  rootPostId?: string
  repliedToId?: string
  hideStatus?: string
  profilePictureUrl?: string
  isVerified?: boolean
}

export interface InsightMetric {
  name: string
  title?: string
  description?: string
  period?: string
  total?: number
  values?: Array<{ value: number; endTime?: string }>
  linkValues?: Array<{ value: number; linkUrl?: string }>
}

export interface PageResult<T> {
  status: 'supported' | 'empty'
  items: T[]
  nextCursor?: string
}

export interface CapabilityResult<T> {
  status: CapabilityStatus
  data?: T
  message?: string
  reauthorizationRequired?: boolean
}

export interface InsightPeriod {
  since: string
  until: string
  label: string
}

export interface InsightComparison {
  days: number
  current: { period: InsightPeriod; metrics: InsightMetric[] }
  previous: { period: InsightPeriod; metrics: InsightMetric[] }
}

export type AuditEventType = 'oauth_connected' | 'oauth_disconnected' | 'publish_attempt' | 'publish_succeeded' | 'publish_failed'
export type AuditOutcome = 'success' | 'failure' | 'started'

export interface AuditEvent {
  id: number
  eventType: AuditEventType
  outcome: AuditOutcome
  occurredAt: string
  resourceId?: string
  errorCategory?: string
}

export interface AuditPage {
  status: 'supported' | 'empty'
  items: AuditEvent[]
  nextCursor?: string
}

export interface PublishInput {
  text: string
  requestId: string
}

export interface PublishResult {
  status: 'published'
  postId: string
  permalink?: string
  timestamp?: string
  message?: string
}

export type PublishRequestState =
  | { state: 'claimed' }
  | { state: 'processing' }
  | { state: 'failed' }
  | { state: 'published'; result: PublishResult }

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
