# SparkPod / Daytona Secret Contract

## Source of truth

The Daytona API credential is an infrastructure secret and is **not application data**.

Production source of truth:

```text
Cloudflare Pages → Settings → Variables and Secrets → Secret
DAYTONA_API_KEY
```

The application reads it only through the Cloudflare runtime binding:

```text
c.env.DAYTONA_API_KEY
        ↓
@daytona/sdk
        ↓
Daytona sandbox
```

## Rules

- Never store `DAYTONA_API_KEY` in D1.
- Never accept the Daytona API key from the browser.
- Never commit the key to GitHub.
- Never put the key in `wrangler.jsonc` or `vars`.
- Never return the key from an API response.
- Keep the Daytona test route owner-only and same-origin protected.
- Remove the secret from Cloudflare when disconnecting Daytona.

Cloudflare Pages Secrets are encrypted bindings intended for API keys and auth tokens.

## Runtime configuration

Optional bindings:

- `DAYTONA_API_URL` — defaults to `https://app.daytona.io/api`
- `DAYTONA_TARGET` — defaults to `us`; supported values are `us` and `eu`

## Test contract

`POST /api/sparkpod/daytona/test` must:

1. Verify the Cloudflare Access owner boundary.
2. Verify same-origin.
3. Read `DAYTONA_API_KEY` from the runtime secret binding.
4. Create a short-lived TypeScript Daytona sandbox.
5. Execute `printf "SparkPod OK\\n"`.
6. Require exit code `0`.
7. Delete the sandbox in `finally`.
8. Return only safe status/output metadata.

## Migration note

The earlier D1 credential table migration may remain in migration history if it was already applied. It is no longer read or written by application code. Do not add new code that depends on that table.
