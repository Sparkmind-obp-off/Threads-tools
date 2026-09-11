# 04 — API Integration Contract

## Security boundary

All provider operations follow:

`Browser → authenticated Threads Tools API → server-side Threads adapter → graph.threads.com`

The browser never receives the App Secret, access token, OAuth code, provider authorization header, or raw provider payload. Provider responses are allow-listed and normalized in `src/threads/normalizers.ts`.

## Server configuration

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`
- `THREADS_REDIRECT_URI`
- `THREADS_API_BASE_URL` (optional; defaults to `https://graph.threads.com`)
- `THREADS_API_VERSION` (optional; defaults to `v1.0`)
- `SESSION_SECRET`
- `OPERATOR_PASSWORD`

Secrets must be supplied through `.dev.vars` locally or Cloudflare Pages secrets in production.

## Current official Phase 2 contract

Verified against Meta's official Threads documentation on 2026-09-11.

### OAuth permissions

The authorization window requests the minimum Phase 2 read set:

- `threads_basic` — required for all Threads API endpoints and owned account/post retrieval.
- `threads_read_replies` — required for GET calls to reply endpoints.
- `threads_manage_insights` — required for GET calls to insights endpoints.

`threads_content_publish` and `threads_manage_replies` are intentionally not requested in Phase 2.

Threads testers may grant these permissions while the app is in development. Users without an app role require App Review approval for each permission and a published app. Existing Phase 1 connections must reconnect to grant the additional Phase 2 permissions.

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

Without `since`/`until`, time-ranged account metrics default to Meta's documented two-day window (yesterday through today). `followers_count` does not support `since`/`until`. Follower demographics are intentionally not requested because they require additional breakdown handling and at least 100 followers.

## Error contract

Provider failures are normalized to safe application errors:

- `NOT_CONNECTED`
- `AUTHORIZATION_EXPIRED`
- `CAPABILITY_NOT_GRANTED`
- `POSTS_READ_FAILED`
- `REPLIES_READ_FAILED`
- `INSIGHTS_READ_FAILED`
- `PROVIDER_RESPONSE_INVALID`
- safe unexpected/provider-unavailable errors

Provider code `190` or HTTP 401 maps to a re-authentication instruction. Permission errors map to an explicit `unsupported` capability state for replies/insights. Raw provider messages are never forwarded.

## Capability and dataset states

- `supported` — operation is available and returned data.
- `unsupported` — permission/capability is unavailable for the current app/token.
- `not_configured` — required server configuration is missing.
- `empty` — valid request returned no records/metrics.
- `error` — provider/network/unexpected failure.

Missing metric values remain absent/undefined and are never converted to zero.

## Official references

- Meta Threads Get Started / permissions: `https://developers.facebook.com/documentation/threads/get-started`
- Access tokens and permissions: `https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions`
- Threads Profiles: `https://developers.facebook.com/documentation/threads/threads-profiles`
- Retrieve User Posts: `https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts`
- Replies and Conversations: `https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations`
- Threads Insights API: `https://developers.facebook.com/documentation/threads/insights`
