# Threads Tools

A small, production-oriented operator console for securely connecting one Threads professional/personal-brand account, publishing real text posts, and reading trustworthy owned-account data. This is an application, not a raw API tester.

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

### Phase 3 — Publish

Implemented:

- Real Compose route with connected-account identity, authoritative UTF-8 byte count, validation, and preview
- Explicit server-side text publishing through container creation and publish endpoints
- Normalized post ID plus optional real permalink/timestamp enrichment
- D1-backed duplicate request protection and no blind retry after an ambiguous provider response
- Honest text-only media capability state; no fake local-file upload
- Safe reconnect, permission, rate-limit, provider, validation, container, publish, and uncertain-result handling

Not implemented:

- Image, video, or carousel publishing (public media hosting/processing is not configured)
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
| `GET` | `/compose` | Validate, preview, and explicitly publish a real text post |
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
| `POST` | `/api/publish/posts` | Validate and publish one text post with a client-generated request ID |
| `GET` | `/auth/threads/start` | OAuth initiation |
| `GET` | `/auth/threads/callback` | OAuth callback/state validation |

## Current Threads API contract

Verified against Meta official documentation on **2026-09-11**.

Permissions requested:

- `threads_basic`
- `threads_content_publish`
- `threads_read_replies`
- `threads_manage_insights`

`threads_manage_replies` is not requested because reply creation/moderation is outside Phase 3.

Provider endpoints used:

- `POST /v1.0/{threads-user-id}/threads` — create a `TEXT` media container with required `text`
- `POST /v1.0/{threads-user-id}/threads_publish` — publish using required `creation_id`
- `GET /v1.0/{threads-media-id}` — best-effort real permalink/timestamp enrichment after publish
- `GET /v1.0/me` — account identity/profile
- `GET /v1.0/me/threads` — owned posts and cursor pagination
- `GET /v1.0/{media-id}/replies` — top-level replies
- `GET /v1.0/{media-id}/insights` — post metrics (`views`, `likes`, `replies`, `reposts`, `quotes`, `shares`)
- `GET /v1.0/{user-id}/threads_insights` — account metrics (`views`, `likes`, `replies`, `reposts`, `quotes`, `clicks`, `followers_count`)

Existing connections must reconnect to grant `threads_content_publish` and any missing read scopes. Threads testers can grant them during development. Users without an app role require App Review approval for each permission and a published app.

Phase 3 enforces Meta's verified text limit as 500 UTF-8 bytes, validates the current five-unique-link limit, and relies on Meta's 250 API-published-post rolling 24-hour quota. The official API supports public-URL image/video and carousel publishing, but this application intentionally exposes only text publishing until secure public media hosting and processing are configured.

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
- `publish_requests`: opaque request ID, account ID, content hash, state, and normalized success result for 24-hour duplicate protection

Posts, replies, and insights are fetched on demand and are not persisted. Post text is not persisted in the duplicate-protection table. No access token, refresh token, App Secret, OAuth code, or provider Authorization header is returned to browser APIs or rendered HTML.

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

Open `http://localhost:3000/settings`, sign in, and connect/reconnect Threads. Then open `http://localhost:3000/compose` to validate, preview, and publish a text post.

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
5. Grant `threads_basic`, `threads_content_publish`, `threads_read_replies`, and `threads_manage_insights`.
6. Confirm the real account appears on `/` and `/compose` identifies the publishing account.
7. Compose and explicitly publish one unique text post; confirm a real post ID and only provider-returned permalink/timestamp fields are shown.
8. Open `/posts` and confirm the real published post appears; verify Load More when Meta returns another cursor.
9. Open `/engagement`, select a post, and verify real top-level replies or an honest Unsupported/Empty state.
10. Open `/insights` and verify real account/post metrics or an honest Unsupported/Empty state.
11. Inspect browser responses/HTML and verify credentials are absent.
12. Revoke/expire the token and verify a reconnect instruction.

## Testing status

Latest implementation gate:

- TypeScript: passing
- Automated tests: **45 passed / 45**
- Production build: passing

Automated tests cover provider success/errors, pagination, replies, insights, text container creation, publish requests, validation, malformed responses, missing optional values, duplicate/ambiguous publish protection, capability states, Compose UI states, and browser credential boundaries.

## Deployment

- **Platform:** Cloudflare Pages + Hono + D1 (BYOK)
- **Production:** https://threads-tools.pages.dev
- **Deployment status:** Active; application shell and D1 schema deployed
- **Provider configuration status:** Not configured in Cloudflare Pages secrets at the time of deployment
- **D1:** `threads-tools-production`; migrations `0001_phase1_connection.sql` and `0002_phase3_publish_requests.sql` required

To activate the provider connection:

1. Add all required environment values with Cloudflare Pages secrets.
2. Set `THREADS_REDIRECT_URI=https://threads-tools.pages.dev/auth/threads/callback`.
3. Add that exact URI to Meta's valid OAuth redirect URIs.
4. Apply production D1 migrations and redeploy if necessary.
5. Connect/reconnect from `/settings` so the token grant includes `threads_content_publish`.

## Gate and next steps

The Phase 3 implementation and automated quality gate pass. The Phase 3 product acceptance gate remains **BLOCKED — production Threads configuration, `threads_content_publish`, and a real successful publish verification are required**. Build success or a mocked provider test is not treated as real-world publishing proof.

Smallest next action: add the seven documented environment variables as Cloudflare Pages secrets, configure Meta's callback URI, apply D1 migrations, reconnect with the Phase 3 scopes, and execute the real-account checklist above. Never paste secret values into source, GitHub, or chat.
