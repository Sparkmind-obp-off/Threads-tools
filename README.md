# Threads Tools

A small, production-oriented operator console for securely connecting one Threads professional/personal-brand account and reading trustworthy owned-account data. This is an application, not a raw API tester.

## Current status

### Phase 1 — Connection

Implemented:

- Password-protected operator workspace with signed `HttpOnly`, `SameSite=Lax` session cookie
- Server-side Threads OAuth with cryptographically random, single-use state
- Short-lived and long-lived token exchange
- AES-GCM encryption before token persistence in Cloudflare D1
- Safe normalized connection status and disconnect

### Phase 2 — Read

Implemented:

- Current connected-account profile details supported by Threads
- Owned Threads post retrieval
- Stable provider-to-application post/reply/insight normalizers
- Cursor-based Load More pagination
- Read-only top-level replies when `threads_read_replies` is granted
- Account and post insights when `threads_manage_insights` is granted
- Explicit loading, supported, unsupported, not-configured, empty, reconnect-required, and error states
- Dashboard, Posts, Engagement, Insights, and Connection/Settings views
- No fake counters, posts, comments, or demo provider data

Not implemented:

- Phase 3 publishing/compose
- Reply moderation or automated replies
- DMs, Instagram, Make.com, bulk engagement, multi-user SaaS, or demand intelligence

## Architecture

```text
Browser UI → Hono server routes → Threads adapter → Meta Threads API
                         ↓
                  Cloudflare D1
          (state hashes + encrypted token)
```

Provider calls live in `src/threads/`, orchestration in `src/services/`, session/cryptography in `src/auth/`, and persistence behind `src/storage/`. The browser consumes allow-listed normalized models only.

## Routes

### Pages

| Method | URI | Purpose |
|---|---|---|
| `GET` | `/` | Real-data operator dashboard |
| `GET` | `/posts` | Owned Threads posts with Load More |
| `GET` | `/engagement` | Per-post top-level reply reader |
| `GET` | `/insights` | Account and recent-post insights |
| `GET` | `/settings` | Connection, reauthorization, and security status |

### Safe application APIs

All connection/read routes require an authenticated operator session.

| Method | URI | Purpose |
|---|---|---|
| `GET` | `/api/configuration` | Safe configured/missing state; no values |
| `GET/POST/DELETE` | `/api/session` | Session status, sign-in, and sign-out |
| `GET` | `/api/connection/status` | Normalized connection state |
| `POST` | `/api/connection/disconnect` | Delete encrypted connection credential |
| `GET` | `/api/read/account` | Current normalized account profile |
| `GET` | `/api/read/posts?after=&limit=` | Bounded owned-post page |
| `GET` | `/api/read/posts/:id/replies?after=&limit=` | Bounded top-level reply page/capability state |
| `GET` | `/api/read/posts/:id/insights` | Supported normalized post metrics |
| `GET` | `/api/read/insights/account` | Supported normalized account metrics |
| `GET` | `/auth/threads/start` | OAuth initiation |
| `GET` | `/auth/threads/callback` | OAuth callback/state validation |

## Current Threads API contract

Verified against Meta official documentation on **2026-09-11**.

Permissions requested:

- `threads_basic`
- `threads_read_replies`
- `threads_manage_insights`

No publish or reply-management permission is requested in Phase 2.

Provider endpoints used:

- `GET /v1.0/me` — account identity/profile
- `GET /v1.0/me/threads` — owned posts and cursor pagination
- `GET /v1.0/{media-id}/replies` — top-level replies
- `GET /v1.0/{media-id}/insights` — post metrics (`views`, `likes`, `replies`, `reposts`, `quotes`, `shares`)
- `GET /v1.0/{user-id}/threads_insights` — account metrics (`views`, `likes`, `replies`, `reposts`, `quotes`, `clicks`, `followers_count`)

Existing Phase 1 connections must reconnect to grant the additional read scopes. Threads testers can grant them during development. Users without an app role require App Review approval for each permission and a published app.

See `docs/04_API_INTEGRATION_CONTRACT.md` for exact fields, metric context, pagination behavior, limitations, and official links.

## Required environment variables

Copy `.env.example` to `.dev.vars` for local development. Never commit `.dev.vars` or real values.

| Variable | Required | Purpose |
|---|---:|---|
| `THREADS_APP_ID` | Yes | Threads-specific App ID |
| `THREADS_APP_SECRET` | Yes | Threads-specific App Secret; server-only |
| `THREADS_REDIRECT_URI` | Yes | Exact OAuth callback URI |
| `THREADS_API_BASE_URL` | No | Defaults to `https://graph.threads.com` |
| `THREADS_API_VERSION` | No | Defaults to `v1.0` |
| `SESSION_SECRET` | Yes | Minimum 32 characters; sessions and token encryption |
| `OPERATOR_PASSWORD` | Yes | Protects the operator console |

Production values must be Cloudflare Pages secrets, not committed configuration.

## Data architecture

Cloudflare D1 stores only:

- `oauth_states`: state hash, expiry, and single-use consumption timestamp
- `threads_connections`: one account identity, timestamps, and AES-GCM encrypted access token

Posts, replies, and insights are fetched on demand and are not persisted. No access token, refresh token, App Secret, OAuth code, or provider Authorization header is returned to browser APIs or rendered HTML.

## Local setup

Requirements: Node.js 20+, npm, Wrangler.

```bash
npm install
cp .env.example .dev.vars
# Replace placeholders only in the uncommitted .dev.vars file.
npm run db:migrate:local
npm run build
npm run preview
```

Open `http://localhost:3000/settings`, sign in, and connect/reconnect Threads.

Quality gate:

```bash
npm run typecheck
npm test
npm run build
```

## Real-account verification

1. Configure all secrets and apply the D1 migration.
2. Register the exact local/production callback URI in Meta App Dashboard.
3. Add the account as a Threads Tester and accept the invitation while the app is in development.
4. Open `/settings`, sign in, and connect/reconnect.
5. Grant `threads_basic`, `threads_read_replies`, and `threads_manage_insights`.
6. Confirm the real account appears on `/`.
7. Confirm owned posts appear on `/posts` and Load More appears when Meta returns another cursor.
8. Open `/engagement`, select a post, and verify real top-level replies or an honest Unsupported/Empty state.
9. Open `/insights` and verify real account/post metrics or an honest Unsupported/Empty state.
10. Inspect browser responses/HTML and verify credentials are absent.
11. Revoke/expire the token and verify a reconnect instruction.

## Testing status

Latest implementation gate:

- TypeScript: passing
- Automated tests: **32 passed / 32**
- Production build: passing

Automated tests cover provider success/errors, pagination, replies, insights, expired authorization, normalization, missing optional values, capability states, UI states, and browser credential boundaries.

## Deployment

Target: Cloudflare Pages + Hono + D1.

1. Create or select the production D1 database and place its non-secret ID in `wrangler.jsonc`.
2. Apply `migrations/0001_phase1_connection.sql` remotely.
3. Add all required environment values with Cloudflare Pages secrets.
4. Build and deploy `dist/`.
5. Update `THREADS_REDIRECT_URI` and Meta's valid OAuth callback to the final HTTPS URL, then reconnect.

## Gate and next steps

The implementation and automated Phase 2 quality gate pass. The product acceptance gate remains **BLOCKED pending real-account verification** until an operator-owned connected account proves real posts and any granted reply/insight capabilities in the deployed environment.

Recommended next action: complete the production OAuth callback/secrets setup, reconnect with Phase 2 scopes, and execute the real-account checklist above. Phase 3 publishing should begin only after that gate passes.
