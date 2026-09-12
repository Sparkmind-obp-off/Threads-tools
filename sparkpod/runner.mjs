#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..')
const image = 'threads-tools-sparkpod:local'
const command = process.argv.slice(2).join(' ').trim()

const allowed = new Set([
  'npm run typecheck',
  'npm test',
  'npm run build',
  'npm run dev',
])

if (!command || !allowed.has(command)) {
  console.error('Allowed commands:')
  for (const item of allowed) console.error(`  ${item}`)
  process.exit(2)
}

if (!existsSync(resolve(repoRoot, 'package.json'))) {
  console.error(`Workspace not found: ${repoRoot}`)
  process.exit(2)
}

console.log(`[SparkPod] workspace: ${repoRoot}`)
console.log(`[SparkPod] command:   ${command}`)
console.log(`[SparkPod] image:     ${image}`)

const build = spawnSync(
  'docker',
  ['build', '-t', image, resolve(repoRoot, 'sparkpod')],
  { stdio: 'inherit' },
)

if (build.status !== 0) process.exit(build.status ?? 1)

const run = spawnSync(
  'docker',
  [
    'run', '--rm', '-i',
    '--network=bridge',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--pids-limit=256',
    '--memory=2g',
    '--cpus=2',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=512m',
    '-v', `${repoRoot}:/workspace:rw`,
    '-w', '/workspace',
    image,
    'sh', '-lc', command,
  ],
  { stdio: 'inherit' },
)

process.exit(run.status ?? 1)
