import { describe, expect, it } from 'vitest'
import { getConfig, missingConfiguration, type Env } from '../src/config/env'

const completeEnv = {
  THREADS_APP_ID: '123', THREADS_APP_SECRET: 'secret',
  THREADS_REDIRECT_URI: 'https://app.example.com/auth/threads/callback',
  THREADS_API_BASE_URL: 'https://graph.threads.com', THREADS_API_VERSION: 'v1.0',
  SESSION_SECRET: 'a'.repeat(32), OPERATOR_PASSWORD: 'strong-password',
} as Env

describe('environment configuration', () => {
  it('reports missing server-only values safely', () => {
    const missing = missingConfiguration({} as Env)
    expect(missing).toContain('Threads App ID')
    expect(missing).toContain('Threads App Secret')
    expect(() => getConfig({} as Env)).toThrowError(/Configuration required/)
  })

  it('accepts HTTPS callback and applies safe defaults', () => {
    const config = getConfig(completeEnv)
    expect(config.threadsApiBaseUrl).toBe('https://graph.threads.com')
    expect(config.threadsApiVersion).toBe('v1.0')
  })

  it('rejects insecure remote callback URLs', () => {
    expect(missingConfiguration({ ...completeEnv, THREADS_REDIRECT_URI: 'http://example.com/callback' })).toContain('Threads redirect URI (HTTPS required outside localhost)')
  })
})
