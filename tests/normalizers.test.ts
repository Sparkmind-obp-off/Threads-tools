import { describe, expect, it } from 'vitest'
import { normalizeInsights, normalizePage, normalizePost } from '../src/threads/normalizers'

describe('Threads provider normalizers', () => {
  it('maps supported post fields to the stable app model', () => {
    expect(normalizePost({
      id: 10, text: 'Post', media_type: 'IMAGE', media_url: 'https://example.com/media.jpg',
      timestamp: '2026-09-11T10:00:00+0000', is_quote_post: false, quoted_post: { id: '9' },
      unknown: 'drop-me',
    })).toEqual({
      id: '10', text: 'Post', mediaType: 'IMAGE', mediaUrl: 'https://example.com/media.jpg',
      timestamp: '2026-09-11T10:00:00+0000', isQuotePost: false, quotedPostId: '9',
    })
  })

  it('keeps missing optional post fields absent', () => {
    const post = normalizePost({ id: '10' })
    expect(post).toEqual({ id: '10' })
    expect(post).not.toHaveProperty('text')
    expect(post).not.toHaveProperty('metrics')
  })

  it('preserves unavailable insight metrics instead of coercing them to zero', () => {
    const [metric] = normalizeInsights({ data: [{ name: 'views', period: 'day', values: [] }] })
    expect(metric).toEqual({ name: 'views', period: 'day' })
    expect(metric).not.toHaveProperty('total')
  })

  it('normalizes pagination cursors and rejects malformed provider payloads', () => {
    expect(normalizePage({ data: [{ id: '1' }], paging: { cursors: { after: 'NEXT' } } }, normalizePost)).toMatchObject({ nextCursor: 'NEXT', items: [{ id: '1' }] })
    expect(() => normalizePage({ data: 'invalid' }, normalizePost)).toThrowError(/malformed paginated data/)
    expect(() => normalizePost({ text: 'missing id' })).toThrowError(/malformed post data/)
  })
})
