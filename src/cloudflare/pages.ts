export const CLOUDFLARE_PAGES_PROJECT = 'threads-tools' as const
export const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4' as const

export const productionVariableKinds = {
  THREADS_APP_ID: 'plain_text',
  THREADS_APP_SECRET: 'secret_text',
  THREADS_REDIRECT_URI: 'plain_text',
  THREADS_API_BASE_URL: 'plain_text',
  THREADS_API_VERSION: 'plain_text',
  SESSION_SECRET: 'secret_text',
} as const

export type ProductionVariableName = keyof typeof productionVariableKinds
export type CloudflareVariableKind = typeof productionVariableKinds[ProductionVariableName]
export type ProductionConfigurationInput = Partial<Record<ProductionVariableName, string>>

type CloudflareEnvVariable = { type: CloudflareVariableKind; value: string }

export interface CloudflarePagesPatch {
  deployment_configs: {
    production: {
      env_vars: Partial<Record<ProductionVariableName, CloudflareEnvVariable>>
    }
  }
}

export function buildProductionEnvironmentPatch(input: ProductionConfigurationInput): CloudflarePagesPatch {
  const envVars: Partial<Record<ProductionVariableName, CloudflareEnvVariable>> = {}
  for (const name of Object.keys(input) as ProductionVariableName[]) {
    const value = input[name]?.trim()
    if (!value) continue
    envVars[name] = { type: productionVariableKinds[name], value }
  }
  return { deployment_configs: { production: { env_vars: envVars } } }
}

export interface CloudflareProjectSafeStatus {
  environment: 'production'
  projectName: string
  readiness: Partial<Record<ProductionVariableName, 'configured' | 'missing'>>
}

export function normalizeProjectConfiguration(project: unknown): CloudflareProjectSafeStatus {
  const source = project && typeof project === 'object' ? project as Record<string, unknown> : {}
  const configs = source.deployment_configs && typeof source.deployment_configs === 'object' ? source.deployment_configs as Record<string, unknown> : {}
  const production = configs.production && typeof configs.production === 'object' ? configs.production as Record<string, unknown> : {}
  const vars = production.env_vars && typeof production.env_vars === 'object' ? production.env_vars as Record<string, unknown> : {}
  const readiness: CloudflareProjectSafeStatus['readiness'] = {}
  for (const name of Object.keys(productionVariableKinds) as ProductionVariableName[]) {
    const binding = vars[name]
    readiness[name] = binding && typeof binding === 'object' ? 'configured' : 'missing'
  }
  return {
    environment: 'production',
    projectName: typeof source.name === 'string' ? source.name : CLOUDFLARE_PAGES_PROJECT,
    readiness,
  }
}

export class CloudflarePagesApiError extends Error {
  constructor(public readonly code: 'AUTHORIZATION_INVALID' | 'CLOUDFLARE_API_FAILURE', message: string) {
    super(message)
    this.name = 'CloudflarePagesApiError'
  }
}

export class CloudflarePagesApi {
  constructor(
    private readonly accountId: string,
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async updateProduction(input: ProductionConfigurationInput): Promise<CloudflareProjectSafeStatus> {
    const response = await this.fetcher(
      `${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(this.accountId)}/pages/projects/${encodeURIComponent(CLOUDFLARE_PAGES_PROJECT)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProductionEnvironmentPatch(input)),
      },
    )
    if (response.status === 401 || response.status === 403) {
      throw new CloudflarePagesApiError('AUTHORIZATION_INVALID', 'Cloudflare authorization is invalid, expired, or lacks Pages Write permission.')
    }
    if (!response.ok) throw new CloudflarePagesApiError('CLOUDFLARE_API_FAILURE', 'Cloudflare could not update the Production configuration.')
    const body = await response.json() as { success?: boolean; result?: unknown }
    if (!body.success || !body.result) throw new CloudflarePagesApiError('CLOUDFLARE_API_FAILURE', 'Cloudflare returned an unsuccessful configuration response.')
    return normalizeProjectConfiguration(body.result)
  }
}
