import type { Env } from './env'

export type ConfigurationState = 'configured' | 'missing'
export type CloudflareBridgeState = 'oauth_ready' | 'oauth_bootstrap_required' | 'owner_boundary_required'

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
    automatedWritesAvailable: boolean
    oauthClient: ConfigurationState
    ownerBoundary: ConfigurationState
    reason: string
    callbackUrl: string
    requiredServerBindings: string[]
    minimumScopeGuidance: string
    grantType: 'authorization_code'
    tokenAuthenticationMethod: 'client_secret_basic'
  }
  actions: {
    cloudflareDashboardUrl: string
    accessDashboardUrl: string
    oauthClientsDashboardUrl: string
    recheckUrl: '/api/configuration'
    redirectUriSuggestion: string
    connectCloudflareUrl?: '/auth/cloudflare/start'
  }
}

const configured = (value: string | undefined): ConfigurationState => value?.trim() ? 'configured' : 'missing'

export function cloudflareOAuthConfigured(env: Env): boolean {
  return Boolean(env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim() && env.CLOUDFLARE_OAUTH_CLIENT_SECRET?.trim() && env.CLOUDFLARE_OAUTH_SCOPES?.trim())
}

export function ownerBoundaryConfigured(env: Env): boolean {
  return Boolean(env.CF_ACCESS_TEAM_DOMAIN?.trim() && env.CF_ACCESS_AUD?.trim() && env.OWNER_EMAIL?.trim())
}

export function productionConfigurationStatus(env: Env, requestUrl: string, missing: string[]): ProductionConfigurationStatus {
  const origin = new URL(requestUrl).origin
  const oauthReady = cloudflareOAuthConfigured(env)
  const ownerReady = ownerBoundaryConfigured(env)
  const bridgeStatus: CloudflareBridgeState = !ownerReady ? 'owner_boundary_required' : !oauthReady ? 'oauth_bootstrap_required' : 'oauth_ready'
  const reason = !ownerReady
    ? 'Configure Cloudflare Access and the owner identity bindings before enabling any Production write.'
    : !oauthReady
      ? 'Create a private Cloudflare OAuth client, then add its client ID, client secret, and exact selected scope identifiers as server-side Production bindings.'
      : 'The private OAuth client and cryptographic Cloudflare Access owner boundary are configured.'
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
      status: bridgeStatus,
      automatedWritesAvailable: oauthReady && ownerReady,
      oauthClient: oauthReady ? 'configured' : 'missing',
      ownerBoundary: ownerReady ? 'configured' : 'missing',
      reason,
      callbackUrl: `${origin}/auth/cloudflare/callback`,
      requiredServerBindings: [
        'CLOUDFLARE_OAUTH_CLIENT_ID', 'CLOUDFLARE_OAUTH_CLIENT_SECRET', 'CLOUDFLARE_OAUTH_SCOPES',
        'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'OWNER_EMAIL', 'SESSION_SECRET',
      ],
      minimumScopeGuidance: 'Select Cloudflare Pages Write and the read capability required for account/project discovery. Copy the exact scope identifiers shown by the OAuth client; do not guess them.',
      grantType: 'authorization_code',
      tokenAuthenticationMethod: 'client_secret_basic',
    },
    actions: {
      cloudflareDashboardUrl: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages',
      accessDashboardUrl: 'https://one.dash.cloudflare.com/',
      oauthClientsDashboardUrl: 'https://dash.cloudflare.com/?to=/:account/oauth-clients',
      recheckUrl: '/api/configuration',
      redirectUriSuggestion: `${origin}/auth/threads/callback`,
      ...(oauthReady && ownerReady ? { connectCloudflareUrl: '/auth/cloudflare/start' as const } : {}),
    },
  }
}
