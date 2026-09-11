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
export type CloudflareEnvVariable = { type: string; value?: string; [key: string]: unknown }

export interface CloudflarePagesPatch {
  deployment_configs: {
    production: {
      env_vars: Record<string, CloudflareEnvVariable>
    }
  }
}

export function buildProductionEnvironmentPatch(
  input: ProductionConfigurationInput,
  current: Record<string, CloudflareEnvVariable> = {},
): CloudflarePagesPatch {
  const envVars: Record<string, CloudflareEnvVariable> = { ...current }
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
  kinds: Partial<Record<ProductionVariableName, CloudflareVariableKind | 'unexpected'>>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function environmentVariables(project: unknown): Record<string, CloudflareEnvVariable> {
  const production = record(record(record(project).deployment_configs).production)
  return record(production.env_vars) as Record<string, CloudflareEnvVariable>
}

export function normalizeProjectConfiguration(project: unknown): CloudflareProjectSafeStatus {
  const source = record(project)
  const vars = environmentVariables(source)
  const readiness: CloudflareProjectSafeStatus['readiness'] = {}
  const kinds: CloudflareProjectSafeStatus['kinds'] = {}
  for (const name of Object.keys(productionVariableKinds) as ProductionVariableName[]) {
    const binding = record(vars[name])
    readiness[name] = Object.keys(binding).length ? 'configured' : 'missing'
    kinds[name] = binding.type === productionVariableKinds[name] ? productionVariableKinds[name] : Object.keys(binding).length ? 'unexpected' : undefined
  }
  return {
    environment: 'production',
    projectName: typeof source.name === 'string' ? source.name : CLOUDFLARE_PAGES_PROJECT,
    readiness,
    kinds,
  }
}

export interface SafeCloudflareAccount { id: string; name: string }
export interface SafeCloudflareProject { name: string; subdomain?: string; productionBranch?: string }

export class CloudflarePagesApiError extends Error {
  constructor(public readonly code: 'AUTHORIZATION_INVALID' | 'CLOUDFLARE_API_FAILURE' | 'PROJECT_BOUNDARY_VIOLATION', message: string) {
    super(message)
    this.name = 'CloudflarePagesApiError'
  }
}

export class CloudflarePagesApi {
  constructor(private readonly accessToken: string, private readonly fetcher: typeof fetch = fetch) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetcher(`${CLOUDFLARE_API_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    })
    if (response.status === 401 || response.status === 403) {
      throw new CloudflarePagesApiError('AUTHORIZATION_INVALID', 'Cloudflare authorization is invalid, expired, or lacks the required Pages permission.')
    }
    if (!response.ok) throw new CloudflarePagesApiError('CLOUDFLARE_API_FAILURE', 'Cloudflare API request failed.')
    const body = await response.json() as { success?: boolean; result?: unknown }
    if (!body.success || body.result === undefined) throw new CloudflarePagesApiError('CLOUDFLARE_API_FAILURE', 'Cloudflare returned an unsuccessful response.')
    return body.result
  }

  async listAccounts(): Promise<SafeCloudflareAccount[]> {
    const result = await this.request('/accounts?per_page=50')
    if (!Array.isArray(result)) throw new CloudflarePagesApiError('CLOUDFLARE_API_FAILURE', 'Cloudflare returned an invalid account list.')
    return result.flatMap((item) => {
      const source = record(item)
      return typeof source.id === 'string' && typeof source.name === 'string' ? [{ id: source.id, name: source.name }] : []
    })
  }

  async listProjects(accountId: string): Promise<SafeCloudflareProject[]> {
    const result = await this.request(`/accounts/${encodeURIComponent(accountId)}/pages/projects?per_page=100`)
    if (!Array.isArray(result)) throw new CloudflarePagesApiError('CLOUDFLARE_API_FAILURE', 'Cloudflare returned an invalid Pages project list.')
    return result.flatMap((item) => {
      const source = record(item)
      if (typeof source.name !== 'string') return []
      return [{
        name: source.name,
        ...(typeof source.subdomain === 'string' ? { subdomain: source.subdomain } : {}),
        ...(typeof source.production_branch === 'string' ? { productionBranch: source.production_branch } : {}),
      }]
    })
  }

  async getProject(accountId: string, projectName: string): Promise<unknown> {
    return this.request(`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`)
  }

  async verifyProjectBoundary(accountId: string, projectName: string): Promise<SafeCloudflareProject> {
    const projects = await this.listProjects(accountId)
    const selected = projects.find((project) => project.name === projectName)
    if (!selected) throw new CloudflarePagesApiError('PROJECT_BOUNDARY_VIOLATION', 'The selected Pages project is not available in the authorized account.')
    return selected
  }

  async configurationStatus(accountId: string, projectName: string): Promise<CloudflareProjectSafeStatus> {
    await this.verifyProjectBoundary(accountId, projectName)
    return normalizeProjectConfiguration(await this.getProject(accountId, projectName))
  }

  async updateProduction(accountId: string, projectName: string, input: ProductionConfigurationInput): Promise<CloudflareProjectSafeStatus> {
    await this.verifyProjectBoundary(accountId, projectName)
    const current = await this.getProject(accountId, projectName)
    const patch = buildProductionEnvironmentPatch(input, environmentVariables(current))
    await this.request(`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    })
    const verified = normalizeProjectConfiguration(await this.getProject(accountId, projectName))
    for (const name of Object.keys(input) as ProductionVariableName[]) {
      if (input[name]?.trim() && (verified.readiness[name] !== 'configured' || verified.kinds[name] !== productionVariableKinds[name])) {
        throw new CloudflarePagesApiError('CLOUDFLARE_API_FAILURE', 'Cloudflare did not verify the requested Production binding.')
      }
    }
    return verified
  }
}
