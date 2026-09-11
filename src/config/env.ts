import { AppError } from '../domain/types'

export interface Env {
  DB: D1Database
  THREADS_APP_ID?: string
  THREADS_APP_SECRET?: string
  THREADS_REDIRECT_URI?: string
  THREADS_API_BASE_URL?: string
  THREADS_API_VERSION?: string
  SESSION_SECRET?: string
  CLOUDFLARE_OAUTH_CLIENT_ID?: string
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: string
  CLOUDFLARE_OAUTH_SCOPES?: string
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  OWNER_EMAIL?: string
}

export interface AppConfig {
  threadsAppId: string
  threadsAppSecret: string
  threadsRedirectUri: string
  threadsApiBaseUrl: string
  threadsApiVersion: string
  sessionSecret: string
}

const required: Array<[keyof Env, string]> = [
  ['THREADS_APP_ID', 'Threads App ID'],
  ['THREADS_APP_SECRET', 'Threads App Secret'],
  ['THREADS_REDIRECT_URI', 'Threads redirect URI'],
  ['SESSION_SECRET', 'Session secret'],
]

export function missingConfiguration(env: Env): string[] {
  const missing = required.filter(([key]) => !env[key]?.toString().trim()).map(([, label]) => label)
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) missing.push('Session secret (minimum 32 characters)')
  try {
    if (env.THREADS_REDIRECT_URI) {
      const uri = new URL(env.THREADS_REDIRECT_URI)
      if (uri.protocol !== 'https:' && uri.hostname !== 'localhost' && uri.hostname !== '127.0.0.1') {
        missing.push('Threads redirect URI (HTTPS required outside localhost)')
      }
    }
  } catch { missing.push('Threads redirect URI (invalid URL)') }
  return [...new Set(missing)]
}

export function getConfig(env: Env): AppConfig {
  const missing = missingConfiguration(env)
  if (missing.length) throw new AppError('CONFIGURATION_MISSING', `Configuration required: ${missing.join(', ')}`, 503)
  const baseUrl = env.THREADS_API_BASE_URL?.trim() || 'https://graph.threads.com'
  const parsedBase = new URL(baseUrl)
  if (parsedBase.protocol !== 'https:') throw new AppError('CONFIGURATION_INVALID', 'Threads API base URL must use HTTPS.', 503)
  return {
    threadsAppId: env.THREADS_APP_ID!,
    threadsAppSecret: env.THREADS_APP_SECRET!,
    threadsRedirectUri: env.THREADS_REDIRECT_URI!,
    threadsApiBaseUrl: baseUrl.replace(/\/$/, ''),
    threadsApiVersion: env.THREADS_API_VERSION?.trim() || 'v1.0',
    sessionSecret: env.SESSION_SECRET!,
  }
}
