import type { Env } from './env'

export type ConfigurationState = 'configured' | 'missing'
export type CloudflareBridgeState = 'manual_setup_required'

export interface ProductionConfigurationStatus {
  status: 'supported' | 'not_configured'
  environment: 'production'
  projectName: 'threads-tools'
  missing: string[]
  readiness: {
    threadsAppId: ConfigurationState
    threadsAppSecret: ConfigurationState
    redirectUri: ConfigurationState
    apiBaseUrl: ConfigurationState
    sessionSecret: ConfigurationState
  }
  bridge: {
    status: CloudflareBridgeState
    automatedWritesAvailable: false
    reason: string
  }
  actions: {
    cloudflareDashboardUrl: string
    recheckUrl: '/api/configuration'
    redirectUriSuggestion: string
  }
}

const configured = (value: string | undefined): ConfigurationState => value?.trim() ? 'configured' : 'missing'

export function productionConfigurationStatus(env: Env, requestUrl: string, missing: string[]): ProductionConfigurationStatus {
  const origin = new URL(requestUrl).origin
  return {
    status: missing.length ? 'not_configured' : 'supported',
    environment: 'production',
    projectName: 'threads-tools',
    missing,
    readiness: {
      threadsAppId: configured(env.THREADS_APP_ID),
      threadsAppSecret: configured(env.THREADS_APP_SECRET),
      redirectUri: configured(env.THREADS_REDIRECT_URI),
      apiBaseUrl: 'configured',
      sessionSecret: env.SESSION_SECRET?.trim() && env.SESSION_SECRET.length >= 32 ? 'configured' : 'missing',
    },
    bridge: {
      status: 'manual_setup_required',
      automatedWritesAvailable: false,
      reason: 'No dedicated Cloudflare OAuth client and secure server-side authorization store are provisioned for this deployment.',
    },
    actions: {
      cloudflareDashboardUrl: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages',
      recheckUrl: '/api/configuration',
      redirectUriSuggestion: `${origin}/auth/threads/callback`,
    },
  }
}
