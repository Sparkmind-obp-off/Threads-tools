# Threads Tools

A private personal operator console for securely connecting one owner’s Threads professional/personal-brand account, publishing real text posts, and reading trustworthy owned-account data. This is neither a SaaS product nor a raw API tester.

## Current status

### Phase 1 — Connection

Implemented:

- Private single-owner workspace with deployment-level access protection when hosted on a public URL
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

### Phase 4 — Operator Polish

Implemented:

- Dashboard connection/configuration health, fast compose/navigation actions, real recent posts, latest-post replies, and available insights
- Bounded local search and chronological sort over provider pages already loaded on `/posts`
- Real post detail with verified permalink-only action, media metadata, available insights, and top-level replies
- Contextual engagement selection with honest top-level-only limitation and capability states
- 7/14/30-day account insight comparisons using Meta-supported `since`/`until` queries; `followers_count` is excluded from comparisons
- Safe D1-backed operational activity for connection and publishing events, with bounded cursor pagination and no content/credential payloads
- Consistent empty, unsupported, error, and reauthorization-required states

### Phase 5 — Personal Setup

Implemented:

- Removed the undocumented in-app operator-password gate and obsolete session endpoint
- Short first-run `/setup` flow with safe Configured/Missing readiness states
- Existing secure Threads OAuth connection/reconnection with post-callback dashboard continuation
- Browser-local, non-sensitive onboarding completion marker so setup does not repeat unnecessarily
- Setup review entry from the operator header and Connection/Settings
- No registration, team, billing, invite, role, tenant, or other SaaS flows

### Phase 5.1 — Production Configuration Center

Implemented:

- Actionable `/setup → Connect Cloudflare → consent → callback → account/project confirmation → Apply Production → Re-check → Connect Threads` flow
- Official private self-managed Cloudflare OAuth Authorization Code bridge using the documented authorization/token endpoints and server-side `client_secret_basic`
- Cryptographically strong, expiring, hashed, single-use OAuth state; codes and credentials never enter normal browser state or responses
- Cryptographic Cloudflare Access JWT verification (signature, issuer, audience, expiry, and exact owner email) on every bridge route; same-origin enforcement on mutations
- Authorized account and Pages project discovery with server-side ownership verification before selection or writes
- AES-GCM-encrypted Cloudflare OAuth access/refresh credential persistence in D1 using the existing `SESSION_SECRET` model
- Official Pages Production read/PATCH/re-read flow, correct `plain_text` / `secret_text` classification, unrelated binding preservation, Preview isolation, safe repeated execution, and honest redeploy-required state
- Password-style Threads secret entry that is cleared after submission and never echoed; manual bootstrap/fallback remains available

The owner must still create the private Cloudflare OAuth client in **Manage Account → OAuth clients**, register the exact callback, select the minimum Pages read/write capabilities, and install the client secret directly as a server-side Production secret. Genspark implements the code but never receives or manages that secret.

### SparkPod — Remote execution foundation

Implemented:

- Focused `/setup` status and connection-test experience positioning SparkPod as the remote execution layer behind the future AI Business Operator
- Server-only `DAYTONA_API_KEY` consumption from a Cloudflare Production Secret; no browser credential entry and no D1 credential persistence
- Bounded Daytona verification flow: create an auto-delete sandbox → execute a deterministic command → verify output → explicitly delete and verify cleanup
- Clear configured/not-configured status, successful step results, and separate secret, authentication, creation, execution, and cleanup failures
- Worker-compatible Daytona REST integration that preserves the existing Hono route architecture without shipping Node-only SDK internals to Cloudflare

Not implemented:

- Browser terminal, file explorer, full IDE/workspace, workspace management, multi-provider UI, SparkPod billing, or SparkPod team management
- Image, video, or carousel publishing (public media hosting/processing is not configured)
- Reply moderation or automated replies
- DMs, Instagram, Make.com, bulk engagement, multi-user SaaS, or demand intelligence

## Architecture

```text
Browser UI → owner-verified Hono routes → Cloudflare OAuth / Pages API
           ↘ Threads adapter → Meta Threads API
                         ↓
                  Cloudflare D1
   (state hashes + AES-GCM-encrypted provider credentials)
```

Threads provider calls live in `src/threads/`, orchestration in `src/services/`, owner verification/cryptography in `src/auth/`, Cloudflare OAuth/Pages adapters in `src/cloudflare/`, and persistence behind D1 repositories. The browser consumes allow-listed normalized models only.

## Routes

### Pages

| Method | URI | Purpose |
|---|---|---|
| `GET` | `/setup` | Production Configuration Center, secure Cloudflare fallback, and Threads connection flow |
| `GET` | `/` | Real-data operator dashboard |
| `GET` | `/posts` | Owned Threads posts with bounded local search/sort and Load More |
| `GET` | `/posts/:id` | Real post detail, available metrics, and top-level reply context |
| `GET` | `/compose` | Validate, preview, and explicitly publish a real text post |
| `GET` | `/engagement` | Per-post top-level reply reader |
| `GET` | `/insights` | Account/current post insights and supported period comparison |
| `GET` | `/activity` | Safe connection/publish operational history |
| `GET` | `/settings` | Connection, reauthorization, and security status |

### Safe application APIs

There is no separate in-app operator password or application sign-in. Because this is a private personal tool, protect publicly reachable production routes with deployment-level access control such as Cloudflare Access. Threads OAuth state validation and encrypted server-side token persistence remain authoritative for the provider connection.

| Method | URI | Purpose |
|---|---|---|
| `GET` | `/api/configuration` | Fresh runtime configured/missing state plus safe bridge/bootstrap metadata; no values |
| `GET` | `/auth/cloudflare/start` | Owner-only real Cloudflare OAuth initiation |
| `GET` | `/auth/cloudflare/callback` | Owner-only state validation and server-side code exchange |
| `GET` | `/api/cloudflare/status` | Safe encrypted-credential connection status |
| `GET` | `/api/cloudflare/resources` | Authorized accounts and Pages projects, names/status only |
| `POST` | `/api/cloudflare/project` | Owner-only verified account/project selection |
| `POST` | `/api/cloudflare/disconnect` | Delete encrypted Cloudflare OAuth credentials |
| `GET` | `/api/configuration/production` | Safe Pages Production presence/type re-check |
| `POST` | `/api/configuration/apply` | Owner-only, same-origin, idempotent Pages Production merge/PATCH/re-read |
| `GET` | `/api/connection/status` | Normalized connection state |
| `POST` | `/api/connection/disconnect` | Delete encrypted connection credential |
| `GET` | `/api/read/account` | Current normalized account profile |
| `GET` | `/api/read/posts?after=&limit=` | Bounded owned-post page |
| `GET` | `/api/read/posts/:id` | One normalized Threads media object |
| `GET` | `/api/read/posts/:id/replies?after=&limit=` | Bounded top-level reply page/capability state |
| `GET` | `/api/read/posts/:id/insights` | Supported normalized post metrics |
| `GET` | `/api/read/insights/account` | Supported normalized account metrics |
| `GET` | `/api/read/insights/account/compare?days=7|14|30` | Two comparable account-insight periods, excluding follower snapshot metrics |
| `GET` | `/api/audit/events?after=&limit=` | Bounded safe operational events |
| `POST` | `/api/publish/posts` | Validate and publish one text post with a client-generated request ID |
| `GET` | `/api/sparkpod/daytona/status` | Owner-only safe SparkPod configuration status; never returns the secret value |
| `POST` | `/api/sparkpod/daytona/test` | Owner-only same-origin create → execute → verify → cleanup test |
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
- `GET /v1.0/{user-id}/threads_insights` — account metrics (`views`, `likes`, `replies`, `reposts`, `quotes`, `clicks`, `followers_count`); Phase 4 also uses supported `since`/`until` ranges without `followers_count` for 7/14/30-day comparisons

Existing connections must reconnect to grant `threads_content_publish` and any missing read scopes. Threads testers can grant them during development. Users without an app role require App Review approval for each permission and a published app.

Phase 3 enforces Meta's verified text limit as 500 UTF-8 bytes, validates the current five-unique-link limit, and relies on Meta's 250 API-published-post rolling 24-hour quota. The official API supports public-URL image/video and carousel publishing, but this application intentionally exposes only text publishing until secure public media hosting and processing are configured.

See `docs/04_API_INTEGRATION_CONTRACT.md` for exact fields, metric context, pagination behavior, limitations, and official links.

## Required environment variables

Copy `.env.example` to `.dev.vars` for local development. Never commit `.dev.vars` or real values.

| Variable | Required | Cloudflare Production type | Purpose |
|---|---:|---|---|
| `THREADS_APP_ID` | Yes | Production Variable (`plain_text`) | Threads-specific App ID |
| `THREADS_APP_SECRET` | Yes | Production encrypted Secret (`secret_text`) | Threads-specific App Secret; server-only |
| `THREADS_REDIRECT_URI` | Yes | Production Variable (`plain_text`) | Exact OAuth callback URI |
| `THREADS_API_BASE_URL` | No | Production Variable (`plain_text`) | Defaults to `https://graph.threads.com` |
| `THREADS_API_VERSION` | No | Production Variable (`plain_text`) | Defaults to `v1.0` |
| `SESSION_SECRET` | Yes | Production encrypted Secret (`secret_text`) | Minimum 32 characters; Threads and Cloudflare credential encryption key material |
| `CLOUDFLARE_OAUTH_CLIENT_ID` | For bridge | Production Variable (`plain_text`) | Private owner-created OAuth client ID |
| `CLOUDFLARE_OAUTH_CLIENT_SECRET` | For bridge | Production encrypted Secret (`secret_text`) | Private OAuth client secret; Genspark never receives it |
| `CLOUDFLARE_OAUTH_SCOPES` | For bridge | Production Variable (`plain_text`) | Space-separated exact scope IDs selected in Cloudflare |
| `CF_ACCESS_TEAM_DOMAIN` | For bridge | Production Variable (`plain_text`) | Access issuer/team domain |
| `CF_ACCESS_AUD` | For bridge | Production Variable (`plain_text`) | Access application audience |
| `OWNER_EMAIL` | For bridge | Production Variable (`plain_text`) | Exact sole owner identity |
| `DAYTONA_API_KEY` | For SparkPod | Production encrypted Secret (`secret_text`) | Daytona infrastructure credential; read only by the server-side SparkPod route |
| `DAYTONA_API_URL` | No | Production Variable (`plain_text`) | Optional Daytona API override; defaults to `https://app.daytona.io/api` |
| `DAYTONA_TARGET` | No | Production Variable (`plain_text`) | Optional Daytona target; `us` by default, or `eu` |

Production values must be Cloudflare Pages bindings with the classifications above, not committed configuration. Secrets cannot be read back after saving and are never returned by the application.

## Data architecture

Cloudflare D1 stores only:

- `oauth_states`: Threads state hash, expiry, and single-use consumption timestamp
- `cloudflare_oauth_states`: Cloudflare state hash, expiry, and single-use consumption timestamp
- `threads_connections`: one account identity, timestamps, and AES-GCM encrypted access token
- `cloudflare_oauth_connection`: AES-GCM encrypted access/refresh credentials plus selected non-secret account/project identifiers
- `publish_requests`: opaque request ID, account ID, content hash, state, and normalized success result for 24-hour duplicate protection
- `audit_events`: allow-listed event type, outcome, safe resource ID/error category, and timestamp; no post text, credentials, or provider payloads

Posts, replies, and insights are fetched on demand and are not persisted. Post text is not persisted in the duplicate-protection table. Daytona credentials are never stored in D1; migration `0006_remove_sparkpod_daytona_credentials.sql` removes the legacy credential table and any historical contents. `DAYTONA_API_KEY` remains a Cloudflare Production Secret and is used only in server-to-server requests. No access token, refresh token, App Secret, OAuth code, Daytona secret, or provider Authorization header is returned to browser APIs or rendered HTML.

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

Open `http://localhost:3000/setup`, review safe readiness states, and connect/reconnect Threads. Select **Continue to Dashboard**, then open `/compose` to validate, preview, and publish a text post. No separate in-app operator password exists.

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
4. Open `/setup` and connect/reconnect through the existing OAuth flow.
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
- Automated tests: **84 passed / 84**
- Production build: passing

Automated tests cover all Phase 1–5 behavior plus Cloudflare authorization/token endpoints, strong state lifecycle, server-side token exchange/redaction, signed Access JWT owner verification, CSRF rejection, account/project discovery and ownership boundaries, encrypted credential-safe status, Production-only payloads, plain-text/secret-text classification, preservation of unrelated variables, post-write re-read, idempotent behavior, invalid/expired authorization, bootstrap fallback, browser/log/response credential boundaries, SparkPod UI security, and Daytona stage-specific failure normalization.

## Deployment

- **Platform:** Cloudflare Pages + Hono + D1 (BYOK)
- **Production:** https://threads-tools.pages.dev
- **Deployment status:** SparkPod remote-execution foundation is implemented and ready for Cloudflare Pages BYOK deployment and owner-only production verification
- **Verified deployment:** Production branch `main`; canonical `https://threads-tools.pages.dev` and the latest immutable deployment URL were both route-verified
- **Provider configuration status:** Not configured; `/setup` now provides exact actions, safe copy controls, the secure manual Cloudflare fallback, and fresh re-checks without exposing values
- **Private access:** Not yet verified/configured; the URL returned HTTP 200 without an Access challenge during deployment verification. Configure Cloudflare Access for all page, API, and OAuth routes before treating it as private. The application intentionally has no in-app operator password.
- **D1:** `threads-tools-production`; migrations `0001`–`0003` are active and `0004_phase5_1_cloudflare_oauth.sql` adds encrypted Cloudflare OAuth persistence

To activate the provider connection:

1. Follow `/setup`: add safe values as Production Variables and `THREADS_APP_SECRET` / `SESSION_SECRET` as encrypted Production Secrets (`OPERATOR_PASSWORD` is not used). Keep the existing `DAYTONA_API_KEY` only as a Cloudflare Production Secret; never enter it in the application.
2. Set `THREADS_REDIRECT_URI=https://threads-tools.pages.dev/auth/threads/callback`.
3. Add that exact URI to Meta's valid OAuth redirect URIs.
4. Connect/reconnect from `/setup` so the token grant includes `threads_content_publish`.

## Gate and next steps

The Phase 5.1 code gate is **BLOCKED** despite passing automated checks because the required real production verification cannot be inferred from tests. The owner must create the private Cloudflare OAuth client, install its client secret and exact scope IDs directly in Cloudflare, configure Cloudflare Access and the three owner-boundary values, apply migration `0004`, redeploy, complete consent/account/project discovery/Production apply/redeploy/re-check, and then verify the existing real Threads connection and dashboard. Never paste any secret into source, GitHub, chat, or the public setup page.
