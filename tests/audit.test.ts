import { describe, expect, it, vi } from 'vitest'
import { D1AuditStore } from '../src/storage/repositories'

function database(results: Array<Record<string, string | number | null>> = []) {
  const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }))
  const all = vi.fn(async () => ({ success: true, results, meta: {} }))
  const bind = vi.fn(() => ({ run, all }))
  const prepare = vi.fn(() => ({ bind }))
  return { db: { prepare } as unknown as D1Database, prepare, bind, run, all }
}

describe('safe Phase 4 audit repository', () => {
  it('records only safe event metadata', async () => {
    const fake = database()
    await new D1AuditStore(fake.db).record('publish_failed', 'failure', '123', 'RATE_LIMITED', new Date('2026-09-11T12:00:00Z'))
    expect(fake.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_events'))
    expect(fake.bind).toHaveBeenCalledWith('publish_failed', 'failure', '123', 'RATE_LIMITED', '2026-09-11T12:00:00.000Z')
    const serialized = JSON.stringify(fake.bind.mock.calls)
    expect(serialized).not.toContain('access_token')
    expect(serialized).not.toContain('Authorization')
    expect(serialized).not.toContain('THREADS_APP_SECRET')
  })

  it('allow-lists rendered fields and exposes bounded cursor pagination', async () => {
    const fake = database([
      { id: 3, event_type: 'publish_succeeded', outcome: 'success', resource_id: 'post-3', error_category: null, occurred_at: '2026-09-11T12:00:00.000Z', access_token: 'must-not-leak' },
      { id: 2, event_type: 'publish_failed', outcome: 'failure', resource_id: null, error_category: 'RATE_LIMITED', occurred_at: '2026-09-11T11:00:00.000Z', provider_payload: 'must-not-leak' },
      { id: 1, event_type: 'oauth_connected', outcome: 'success', resource_id: '42', error_category: null, occurred_at: '2026-09-11T10:00:00.000Z' },
    ])
    const result = await new D1AuditStore(fake.db).list(undefined, 2)
    expect(result).toEqual({
      status: 'supported',
      items: [
        { id: 3, eventType: 'publish_succeeded', outcome: 'success', resourceId: 'post-3', occurredAt: '2026-09-11T12:00:00.000Z' },
        { id: 2, eventType: 'publish_failed', outcome: 'failure', errorCategory: 'RATE_LIMITED', occurredAt: '2026-09-11T11:00:00.000Z' },
      ],
      nextCursor: '2',
    })
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(fake.bind).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, 3)
  })
})
