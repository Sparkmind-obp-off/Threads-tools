# Threads Tools

A production-oriented operator console for securely connecting one professional/personal-brand Threads account. This repository is an application foundation—not a raw Threads API tester.

## Phase 1 status

Implemented:

- Responsive dashboard and Connection / Settings UI
- Operator-password authentication with signed, `HttpOnly`, `SameSite=Lax` session cookie
- Server-side Threads OAuth initiation using cryptographically random, single-use state
- OAuth callback validation, short-lived token exchange, and long-lived token exchange
- Minimum account lookup (`id`, `username`, `name`) through a provider adapter
- AES-GCM encryption before token persistence in Cloudflare D1
- Safe normalized connection status and disconnect action
- Explicit missing-configuration, loading, connected, disconnected, and safe error states
- Unit tests for critical configuration, OAuth, provider, and secret-boundary paths

Not implemented (intentional later phases): posts, publishing, replies/comments, insights, Instagram, automation, or fake/demo provider data.

## Architecture

```text
Browser UI → Hono server routes → Threads adapter → Meta Threads API
                         ↓
                Cloudflare D1
        (state hashes + encrypted token)
```

Provider calls are isolated in `src/threads/`. OAuth orchestration is in `src/services/`, session/cryptography in `src/auth/`, and persistence behind interfaces in `src/storage/`. Browser responses use normalized objects and never include authorization codes, app secrets, or access tokens.

## Required environment variables

Copy `.env.example` to `.dev.vars` for local development and supply real values only through uncommitted local configuration or Cloudflare Pages secrets.

| Variable | Required | Purpose |
|---|---:|---|
| `THREADS_APP_ID` | Yes | Threads-specific App ID from Meta App Dashboard |
| `THREADS_APP_SECRET` | Yes | Threads-specific App Secret; server-only |
| `THREADS_REDIRECT_URI` | Yes | Exact OAuth callback URL |
| `THREADS_API_BASE_URL` | No | Defaults to `https://graph.threads.com` |
| `THREADS_API_VERSION` | No | Defaults to `v1.0` |
| `SESSION_SECRET` | Yes | At least 32 random characters; signs sessions and derives the token-encryption key |
| `OPERATOR_PASSWORD` | Yes | Password protecting connection-management routes |

Generate secrets with a cryptographically secure password generator. Do not commit `.dev.vars`, `.env`, tokens, or real credentials.

## Local setup

Requirements: Node.js 20+, npm, and Wrangler.

```bash
npm install
cp .env.example .dev.vars
# Replace placeholders in .dev.vars with local values.
npx wrangler d1 migrations apply threads-tools-production --local
npm run build
npx wrangler pages dev dist --d1=threads-tools-production --local --ip 0.0.0.0 --port 3000
```

Open `http://localhost:3000/settings`, sign in with `OPERATOR_PASSWORD`, and select **Connect Threads**.

Quality commands:

```bash
npm run typecheck
npm test
npm run build
```

## Meta / Threads configuration

1. Create or open a Meta developer app and add the **Threads use case**.
2. Use the Threads-specific App ID and corresponding App Secret (not another Meta product's credentials).
3. Add the exact redirect URI to the app's valid OAuth redirect URIs:
   - Local: `http://localhost:3000/auth/threads/callback`
   - Production: `https://<your-domain>/auth/threads/callback`
4. Add the real Threads account as a **Threads Tester** and accept the invitation in Threads Website permissions while the app is in development mode.
5. Phase 1 requests only `threads_basic`. Public users outside app roles require permission approval and a published app.

Meta's documented Phase 1 contract verified on 2026-09-11:

- Authorization: `https://threads.com/oauth/authorize`
- Code exchange: `POST https://graph.threads.com/oauth/access_token`
- Long-lived exchange: `GET https://graph.threads.com/access_token`
- Connected account: `GET https://graph.threads.com/v1.0/me?fields=id,username,name`

Provider endpoints and versions remain configurable through the adapter/environment contract.

## Real-account verification

1. Configure all server secrets and apply the D1 migration.
2. Register the exact production callback URL in Meta App Dashboard.
3. Open `/settings` and sign in.
4. Select **Connect Threads**, authorize the tester/account at Threads, and return to the callback.
5. Confirm the UI shows the real account ID, username/display name, connection time, and authorization expiry.
6. Inspect browser Network responses and verify no `access_token`, app secret, or authorization code is returned.
7. Select **Disconnect** and confirm status returns to disconnected and the D1 credential row is deleted.

The Phase 1 product gate remains **BLOCKED — configuration required** until this real-account flow is completed with operator-owned Meta credentials and provider-side settings.

## Routes

| Method | URI | Purpose |
|---|---|---|
| `GET` | `/` | Phase 1 dashboard shell |
| `GET` | `/settings` | Connection and settings UI |
| `GET` | `/api/configuration` | Safe configuration capability state; no secret values |
| `GET` | `/api/session` | Safe operator-session status |
| `POST` | `/api/session` | Operator sign-in |
| `DELETE` | `/api/session` | Operator sign-out |
| `GET` | `/api/connection/status` | Authenticated normalized connection state |
| `POST` | `/api/connection/disconnect` | Authenticated credential deletion |
| `GET` | `/auth/threads/start` | Authenticated OAuth initiation |
| `GET` | `/auth/threads/callback` | Authenticated provider callback and state validation |

## Data model

Cloudflare D1 stores:

- `oauth_states`: SHA-256 state hashes, expiry, and single-use consumption timestamp
- `threads_connections`: one account identity, timestamps, and AES-GCM encrypted access token

Raw tokens are never returned by public APIs. Replacing D1 with another production store requires implementing the `OAuthStateStore` and `ConnectionStore` interfaces.

## Deployment

Target: Cloudflare Pages with Hono, D1, and server-side Pages secrets.

Before deployment:

1. Create the production D1 database and replace the placeholder `database_id` in `wrangler.jsonc`.
2. Apply `migrations/0001_phase1_connection.sql` remotely.
3. Add every required variable above using `wrangler pages secret put`; do not place values in `wrangler.jsonc`.
4. Deploy `dist/`, then update `THREADS_REDIRECT_URI` and Meta's valid callback URI to the final HTTPS URL.

## Recommended next steps

1. Complete real-account OAuth verification and mark the Phase 1 gate PASS.
2. Add automated token refresh before expiry and safe operational audit events.
3. Begin Phase 2 only after the connection gate passes.
