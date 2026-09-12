#!/usr/bin/env node

import { Daytona } from '@daytona/sdk'

const daytona = new Daytona()
let sandbox

try {
  console.log('[SparkPod/Daytona] creating sandbox...')
  sandbox = await daytona.create({
    language: 'typescript',
    name: 'sparkpod-smoke-test',
    autoDeleteInterval: 15,
    ttlMinutes: 15,
  })

  console.log(`[SparkPod/Daytona] sandbox: ${sandbox.id}`)
  console.log(`[SparkPod/Daytona] state:   ${sandbox.state}`)

  const commands = [
    'node --version',
    'npm --version',
    'git --version',
    'printf "sparkpod-daytona-ok\\n"',
  ]

  for (const command of commands) {
    console.log(`\\n[SparkPod/Daytona] exec: ${command}`)
    const response = await sandbox.process.executeCommand(command)
    console.log(response.result)
  }

  console.log('\\n[SparkPod/Daytona] smoke test PASSED')
} catch (error) {
  console.error('\\n[SparkPod/Daytona] smoke test FAILED')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (sandbox) {
    try {
      console.log('[SparkPod/Daytona] deleting sandbox...')
      await sandbox.delete(60, true)
      console.log('[SparkPod/Daytona] sandbox deleted')
    } catch (error) {
      console.error('[SparkPod/Daytona] cleanup failed')
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }

  await daytona[Symbol.asyncDispose]?.()
}
