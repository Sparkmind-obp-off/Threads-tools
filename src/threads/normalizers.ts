import { AppError, type InsightMetric, type ThreadsAccount, type ThreadsPost, type ThreadsReply } from '../domain/types'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function requiredId(value: unknown, entity: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
    throw new AppError('PROVIDER_RESPONSE_INVALID', `Threads returned malformed ${entity} data.`, 502)
  }
  return String(value)
}

function referenceId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  const item = record(value)
  return item ? optionalString(typeof item.id === 'number' ? String(item.id) : item.id) : undefined
}

export function normalizeAccount(payload: unknown): ThreadsAccount {
  const item = record(payload)
  if (!item) throw new AppError('PROVIDER_RESPONSE_INVALID', 'Threads returned malformed account data.', 502)
  return compact({
    id: requiredId(item.id, 'account'),
    username: optionalString(item.username),
    name: optionalString(item.name),
    profilePictureUrl: optionalString(item.threads_profile_picture_url),
    biography: optionalString(item.threads_biography),
    isVerified: optionalBoolean(item.is_verified),
  })
}

export function normalizePost(payload: unknown): ThreadsPost {
  const item = record(payload)
  if (!item) throw new AppError('PROVIDER_RESPONSE_INVALID', 'Threads returned malformed post data.', 502)
  return compact({
    id: requiredId(item.id, 'post'),
    text: optionalString(item.text),
    timestamp: optionalString(item.timestamp),
    permalink: optionalString(item.permalink),
    mediaType: optionalString(item.media_type),
    mediaUrl: optionalString(item.media_url),
    thumbnailUrl: optionalString(item.thumbnail_url),
    username: optionalString(item.username),
    shortcode: optionalString(item.shortcode),
    topicTag: optionalString(item.topic_tag),
    altText: optionalString(item.alt_text),
    linkAttachmentUrl: optionalString(item.link_attachment_url),
    gifUrl: optionalString(item.gif_url),
    isQuotePost: optionalBoolean(item.is_quote_post),
    quotedPostId: referenceId(item.quoted_post),
    repostedPostId: referenceId(item.reposted_post),
  })
}

export function normalizeReply(payload: unknown): ThreadsReply {
  const item = record(payload)
  const post = normalizePost(item)
  return compact({
    ...post,
    hasReplies: optionalBoolean(item?.has_replies),
    isReply: optionalBoolean(item?.is_reply),
    isOwnedByMe: optionalBoolean(item?.is_reply_owned_by_me),
    rootPostId: referenceId(item?.root_post),
    repliedToId: referenceId(item?.replied_to),
    hideStatus: optionalString(item?.hide_status),
    profilePictureUrl: optionalString(item?.profile_picture_url),
    isVerified: optionalBoolean(item?.is_verified),
  })
}

export function normalizePublishId(payload: unknown, entity = 'publish response'): string {
  const item = record(payload)
  if (!item) throw new AppError('PROVIDER_RESPONSE_INVALID', `Threads returned malformed ${entity} data.`, 502)
  return requiredId(item.id, entity)
}

export function normalizePage<T>(payload: unknown, normalizer: (item: unknown) => T): { items: T[]; nextCursor?: string } {
  const body = record(payload)
  if (!body || !Array.isArray(body.data)) throw new AppError('PROVIDER_RESPONSE_INVALID', 'Threads returned malformed paginated data.', 502)
  const cursors = record(record(body.paging)?.cursors)
  return {
    items: body.data.map(normalizer),
    nextCursor: optionalString(cursors?.after),
  }
}

export function normalizeInsights(payload: unknown): InsightMetric[] {
  const body = record(payload)
  if (!body || !Array.isArray(body.data)) throw new AppError('PROVIDER_RESPONSE_INVALID', 'Threads returned malformed insights data.', 502)
  return body.data.map((entry) => {
    const item = record(entry)
    if (!item) throw new AppError('PROVIDER_RESPONSE_INVALID', 'Threads returned malformed metric data.', 502)
    const values = Array.isArray(item.values)
      ? item.values.flatMap((value) => {
          const point = record(value)
          return point && typeof point.value === 'number'
            ? [{ value: point.value, endTime: optionalString(point.end_time) }]
            : []
        })
      : undefined
    const totalValue = record(item.total_value)
    const linkValues = Array.isArray(item.link_total_values)
      ? item.link_total_values.flatMap((value) => {
          const point = record(value)
          return point && typeof point.value === 'number'
            ? [{ value: point.value, linkUrl: optionalString(point.link_url) }]
            : []
        })
      : undefined
    return compact({
      name: requiredId(item.name, 'metric'),
      title: optionalString(item.title),
      description: optionalString(item.description),
      period: optionalString(item.period),
      total: typeof totalValue?.value === 'number' ? totalValue.value : undefined,
      values: values?.length ? values : undefined,
      linkValues: linkValues?.length ? linkValues : undefined,
    })
  })
}
