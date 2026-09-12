#!/usr/bin/env node

const apiKey = process.env.DAYTONA_API_KEY?.trim()
const apiUrl = (process.env.DAYTONA_API_URL?.trim() || 'https://app.daytona.io/api').replace(/\/$/, '')
const target = process.env.DAYTONA_TARGET?.trim() || 'us'

if (!apiKey) {
  console.error('[SparkPod/Daytona] DAYTONA_API_KEY is required in the local process environment.')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Daytona-Source': 'sparkpod-smoke',
}

async function request(url, init) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } })
  if (!response.ok) throw new Error(`Daytona request failed with status ${response.status}`)
  if (response.status === 204) return undefined
  return response.json()
}

async function getSandbox(id) {
  return request(`${apiUrl}/sandbox/${encodeURIComponent(id)}`, { method: 'GET' })
}

async function waitForStarted(initial) {
  let sandbox = initial
  const deadline = Date.now() + 45_000
  while (sandbox.state !== 'started') {
    if (['error', 'build_failed'].includes(sandbox.state)) throw new Error('Sandbox entered a failed state')
    if (Date.now() >= deadline) throw new Error('Sandbox start timed out')
    await new Promise((resolve) => setTimeout(resolve, 750))
    sandbox = await getSandbox(sandbox.id)
  }
  return sandbox
}

let sandbox
try {
  console.log('[SparkPod/Daytona] creating sandbox...')
  sandbox = await waitForStarted(await request(`${apiUrl}/sandbox`, {
    method: 'POST',
    body: JSON.stringify({
      name: `sparkpod-smoke-${crypto.randomUUID().slice(0, 8)}`,
      labels: { 'code-toolbox-language': 'typescript' },
      target,
      autoDeleteInterval: 15,
    }),
  }))

  console.log(`[SparkPod/Daytona] sandbox: ${sandbox.id}`)
  console.log(`[SparkPod/Daytona] state:   ${sandbox.state}`)

  let proxyUrl = sandbox.toolboxProxyUrl
  if (!proxyUrl) {
    proxyUrl = (await request(`${apiUrl}/sandbox/${encodeURIComponent(sandbox.id)}/toolbox-proxy-url`, { method: 'GET' })).url
  }
  const toolboxBase = `${proxyUrl.replace(/\/$/, '')}/${encodeURIComponent(sandbox.id)}`
  for (const command of ['node --version', 'npm --version', 'git --version', 'printf "sparkpod-daytona-ok\\n"']) {
    console.log(`\n[SparkPod/Daytona] exec: ${command}`)
    const response = await request(`${toolboxBase}/process/execute`, {
      method: 'POST',
      body: JSON.stringify({ command, timeout: 10 }),
    })
    if ((response.exitCode ?? response.code) !== 0) throw new Error(`Command failed: ${command}`)
    console.log(response.result)
  }

  console.log('\n[SparkPod/Daytona] smoke test PASSED')
} catch (error) {
  console.error('\n[SparkPod/Daytona] smoke test FAILED')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (sandbox) {
    try {
      console.log('[SparkPod/Daytona] deleting sandbox...')
      await request(`${apiUrl}/sandbox/${encodeURIComponent(sandbox.id)}`, { method: 'DELETE' })
      console.log('[SparkPod/Daytona] sandbox deletion requested')
    } catch (error) {
      console.error('[SparkPod/Daytona] cleanup failed')
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
