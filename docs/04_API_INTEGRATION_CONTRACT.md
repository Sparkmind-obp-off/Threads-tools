# 04 — API Integration Contract

## Security boundary

All provider operations follow:

`Private browser session (deployment-level access) → Threads Tools API → server-side Threads adapter → graph.threads.com`

The browser never receives the App Secret, access token, OAuth code, provider authorization header, or raw provider payload. Provider responses are allow-listed and normalized in `src/threads/normalizers.ts`.

## Server configuration

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`
- `THREADS_REDIRECT_URI`
- `THREADS_API_BASE_URL` (optional; defaults to `https://graph.threads.com`)
- `THREADS_API_VERSION` (optional; defaults to `v1.0`)
- `SESSION_SECRET` (token-encryption key material)

Secrets must be supplied through `.dev.vars` locally or Cloudflare Pages secrets in production. There is no separate in-app operator password. Protect a publicly reachable deployment with Cloudflare Access or equivalent deployment-level private access, covering pages, APIs, and OAuth routes.

## Current official Phase 2/3 contract

Verified against Meta's official Threads documentation on 2026-09-11. Provider requests use the configurable version path `THREADS_API_VERSION`; the application default and the official publishing examples verified for this implementation use `v1.0`.

### OAuth permissions

The authorization window requests the minimum Phase 3 publish plus existing read set:

- `threads_basic` — required for all Threads API endpoints and owned account/post retrieval.
- `threads_content_publish` — required for Threads publishing endpoints.
- `threads_read_replies` — required for GET calls to reply endpoints.
- `threads_manage_insights` — required for GET calls to insights endpoints.

`threads_manage_replies` is intentionally not requested because reply creation/moderation is outside Phase 3.

Threads testers may grant these permissions while the app is in development. Users without an app role require App Review approval for each permission and a published app. Existing connections must reconnect to grant `threads_content_publish`.

### Text publishing

Phase 3 implements the official two-step text-only flow:

1. `POST /v1.0/{threads-user-id}/threads` with form fields `media_type=TEXT` and required non-empty `text`.
2. `POST /v1.0/{threads-user-id}/threads_publish` with form field `creation_id={container-id}`.
3. Best-effort enrichment after a successful publish: `GET /v1.0/{threads-media-id}?fields=id,permalink,timestamp,text,media_type`.

All three calls use the access token only in the server-to-provider `Authorization: Bearer` header. The browser receives only the normalized application result. The publish ID returned by `threads_publish` is authoritative; permalink and timestamp are shown only when the follow-up media lookup actually returns them.

Current verified limits and behavior:

- Text posts are limited to 500 characters, with emojis counted by UTF-8 bytes; the application therefore enforces a 500 UTF-8-byte limit on both client and server.
- Threads rejects posts containing more than 5 unique links during container creation (effective December 22, 2025); the application validates this before provider calls.
- Profiles are limited to 250 API-published posts in a rolling 24-hour period; `threads_publish` enforces the quota.
- Containers expire after 24 hours if unpublished.
- Container status values documented by Meta are `EXPIRED`, `ERROR`, `FINISHED`, `IN_PROGRESS`, and `PUBLISHED`. Text publishing uses the direct two-step flow; no automatic blind publish retry or background polling is performed.
- Meta recommends allowing processing time before publishing media containers. Phase 3 intentionally excludes image, video, and carousel publishing, so it does not expose local-file or public-URL controls.

The official API supports `TEXT`, `IMAGE`, `VIDEO`, and `CAROUSEL`; this application supports only `TEXT` in Phase 3. Images/videos must be hosted on a publicly accessible server and satisfy Meta media specifications. They are truthfully shown as not configured rather than represented by fake upload controls.

### Account

`GET /v1.0/me?fields=id,username,name,threads_profile_picture_url,threads_biography,is_verified`

Permission: `threads_basic`.

### Owned posts

`GET /v1.0/me/threads`

Requested fields:

`id,media_product_type,media_type,media_url,permalink,username,text,timestamp,shortcode,thumbnail_url,is_quote_post,quoted_post,reposted_post,alt_text,link_attachment_url,gif_url,topic_tag`

Permission: `threads_basic`.

The endpoint uses cursor pagination. The provider response exposes `paging.cursors.before` and `paging.cursors.after`, but does not guarantee `previous` or `next` links. Threads Tools exposes only an opaque normalized `nextCursor` and fetches bounded pages (maximum provider limit: 100).

### Top-level replies

`GET /v1.0/{threads-media-id}/replies`

Permission: `threads_basic` + `threads_read_replies`.

The endpoint returns immediate/top-level replies and supports cursor pagination. Phase 2 intentionally does not call reply-management POST endpoints. Nested replies are indicated only by supported metadata such as `has_replies`; the UI does not fabricate a flattened conversation.

### Post insights

`GET /v1.0/{threads-media-id}/insights?metric=views,likes,replies,reposts,quotes,shares`

Permission: `threads_basic` + `threads_manage_insights`.

Metrics are lifetime values where supplied by Meta. Nested-reply metrics are not included. Repost-facade media can return an empty array. `views` and `shares` are documented by Meta as in development.

### Account insights

`GET /v1.0/{threads-user-id}/threads_insights?metric=views,likes,replies,reposts,quotes,clicks,followers_count`

Permission: `threads_basic` + `threads_manage_insights`.

Without `since`/`until`, time-ranged account metrics default to Meta's documented two-day window (yesterday through today). Phase 4 additionally sends paired bounded `since`/`until` Unix timestamp requests for 7, 14, or 30 days using `views,likes,replies,reposts,quotes,clicks`. `followers_count` does not support `since`/`until` and is therefore excluded from comparison requests. Follower demographics are intentionally not requested because they require additional breakdown handling and at least 100 followers.

## Error contract

Provider failures are normalized to safe application errors:

- `NOT_CONNECTED`
- `AUTHORIZATION_EXPIRED`
- `CAPABILITY_NOT_GRANTED`
- `POSTS_READ_FAILED`
- `REPLIES_READ_FAILED`
- `INSIGHTS_READ_FAILED`
- `VALIDATION_FAILED`
- `CONTAINER_CREATION_FAILED`
- `PUBLISH_FAILED`
- `PUBLISH_RESULT_UNCERTAIN`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `DUPLICATE_IN_PROGRESS`
- `DUPLICATE_REQUEST`
- `PROVIDER_RESPONSE_INVALID`
- safe unexpected/provider-unavailable errors

Provider code `190` or HTTP 401 maps to a re-authentication instruction. Permission errors map to safe capability/reconnect guidance. HTTP 429 and documented rate-limit codes map to `RATE_LIMITED`. A transport or provider-availability failure after container creation maps to `PUBLISH_RESULT_UNCERTAIN`; the application does not automatically republish. Raw provider messages are never forwarded.

## Capability and dataset states

- `supported` — operation is available and returned data.
- `unsupported` — permission/capability is unavailable for the current app/token.
- `not_configured` — required server configuration is missing.
- `empty` — valid request returned no records/metrics.
- `error` — provider/network/unexpected failure.
- `reauthorization_required` — the provider rejected or the stored credential expired and the operator must reconnect.

Missing metric values remain absent/undefined and are never converted to zero.

## Phase 5.1 Cloudflare Production configuration contract

Verified against Cloudflare's official documentation on 2026-09-11:

- Project endpoint: `PATCH /accounts/{account_id}/pages/projects/{project_name}`.
- Target: `deployment_configs.production.env_vars`; no Preview configuration is included.
- Safe values use `{ "type": "plain_text", "value": "..." }`.
- `THREADS_APP_SECRET` and `SESSION_SECRET` use `{ "type": "secret_text", "value": "..." }`.
- Updates modify supplied environment variables; deletion requires setting the key to `null`.
- Required API permission: account-level **Pages Write**.
- Cloudflare supports OAuth 2.0 Authorization Code clients, including private clients for members of the parent account.

`src/cloudflare/oauth.ts` implements Cloudflare's official private self-managed OAuth Authorization Code bridge using `https://dash.cloudflare.com/oauth2/auth` and `https://dash.cloudflare.com/oauth2/token`. `src/cloudflare/pages.ts` discovers authorized accounts/projects, enforces the account/project boundary, reads Production configuration, preserves unrelated bindings, PATCHes only Production, and re-reads for safe presence/type verification. OAuth credentials are encrypted before D1 persistence and never enter browser state or responses. The client secret is an external owner bootstrap secret that Genspark never receives. Manual Variables/Secrets configuration remains available when that bootstrap is absent.

Official Cloudflare references:

- Pages project update: `https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/`
- Pages bindings / Variables and Secrets: `https://developers.cloudflare.com/pages/functions/bindings/`
- API token permissions: `https://developers.cloudflare.com/fundamentals/api/reference/permissions/`
- OAuth overview, client creation, and endpoints: `https://developers.cloudflare.com/fundamentals/oauth/`, `https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/`, and `https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/`

## Phase 5 application endpoints

- `GET /api/configuration` returns only allow-listed runtime readiness and safe bootstrap metadata; no environment value is returned and the response is `no-store`.
- `GET /auth/cloudflare/start` and `GET /auth/cloudflare/callback` require a valid signed owner Cloudflare Access assertion; state is random, hashed, expiring, and single-use, and code exchange is server-side.
- `GET /api/cloudflare/status` and `GET /api/cloudflare/resources` return safe connection/account/project metadata only.
- `POST /api/cloudflare/project` verifies both the Access owner and the selected project under the authorized account before persisting non-secret identifiers.
- `GET /api/configuration/production` re-reads the selected Pages project and returns value-free presence/type status.
- `POST /api/configuration/apply` requires signed owner authorization and same-origin POST, accepts only validated Threads App ID/App Secret input, performs the idempotent Production merge/PATCH/re-read, and never returns secrets.
- `POST /api/cloudflare/disconnect` deletes encrypted Cloudflare OAuth credentials.
- `GET /api/connection/status` returns only normalized Threads account/connection metadata and never credentials.
- The removed `/api/session` password endpoint is not replaced by another application password. Cloudflare Access is the cryptographically verified owner boundary.

## Phase 4 application endpoints

- `GET /api/read/posts/:id` reuses the verified single-media provider endpoint and returns an allow-listed normalized post.
- `GET /api/read/insights/account/compare?days=7|14|30` returns current and previous period labels plus only provider-returned metrics.
- `GET /api/audit/events?after=&limit=` reads D1 application events only and does not call Threads.

Search/sort is deliberately local to already-loaded post pages; no provider filtering contract is claimed.

## Official references

- Meta Threads Get Started / permissions: `https://developers.facebook.com/documentation/threads/get-started`
- Access tokens and permissions: `https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions`
- Threads Profiles: `https://developers.facebook.com/documentation/threads/threads-profiles`
- Retrieve User Posts: `https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts`
- Replies and Conversations: `https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations`
- Threads Insights API: `https://developers.facebook.com/documentation/threads/insights`
- Threads Posts (publishing, fields, limits, media specs): `https://developers.facebook.com/documentation/threads/posts`
- Publish endpoint reference: `https://developers.facebook.com/documentation/threads/reference/publishing`
- Threads API overview and publishing quota: `https://developers.facebook.com/documentation/threads/overview`
- Container troubleshooting/status: `https://developers.facebook.com/documentation/threads/troubleshooting`
