# Mini SparkPod — Threads Tools POC

Mini SparkPod is the first execution-plane proof inside Threads Tools. It is intentionally local-only for the first milestone.

## Goal

Prove this chain before building a standalone SparkPod product:

`project workspace → isolated sandbox → terminal command → build/test → preview → later Cloudflare deploy`

## What this POC is

- A Docker-backed execution sandbox.
- A persistent workspace mounted from the Threads Tools repository.
- A small CLI runner for controlled development commands.
- A foundation for a future remote execution service.

## What this POC is NOT

- Not a production remote terminal.
- Not an unauthenticated HTTP command executor.
- Not a production secret store.
- Not the final SparkPod platform.
- It does not execute commands inside Cloudflare Pages/Workers; Cloudflare remains the deployment target.

## Prerequisites

- Docker installed and running.
- Threads Tools repository checked out locally.

## First proof

From the repository root:

```bash
node sparkpod/runner.mjs "npm run typecheck"
node sparkpod/runner.mjs "npm test"
node sparkpod/runner.mjs "npm run build"
```

The runner executes the command inside the `sparkpod-sandbox` Docker container. The repository is mounted at `/workspace`.

## Security boundary for this milestone

The runner is local-only and does not expose a network endpoint. The container runs as a non-root user, has a read-only root filesystem, drops Linux capabilities, and uses a temporary `/tmp`. The workspace is the only persistent mount.

Do not place production credentials in the workspace. Production Cloudflare/Threads secrets remain in the production secret system and are not passed to this sandbox.

## Next gates

1. Local sandbox boots.
2. Typecheck passes.
3. Tests pass.
4. Build passes.
5. Preview works locally.
6. Only after those gates pass: connect the existing Cloudflare deployment bridge.
7. Only after deployment is proven: extract this execution layer into standalone SparkPod.
