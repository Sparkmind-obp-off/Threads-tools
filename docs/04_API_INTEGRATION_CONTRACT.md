# 04 — API Integration Contract

## Configuration

Required configuration is provided server-side through environment secrets, for example:

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`
- `THREADS_REDIRECT_URI`
- `THREADS_API_BASE_URL` (when useful for environment configuration)
- application/session secret as required by the chosen framework

Never expose the App Secret through `NEXT_PUBLIC_*`, browser bundles, source code, logs, or client configuration.

## OAuth flow

1. User selects Connect Threads.
2. Server generates OAuth authorization URL and state.
3. User authorizes the Meta/Threads app.
4. Callback validates state.
5. Server exchanges the authorization result for tokens using the secret server-side.
6. Server stores the minimum required token metadata securely.
7. UI receives only safe connection/account status.

## API adapter

Implement provider calls behind functions such as:

- `getAccount()`
- `listPosts()`
- `getPost()`
- `createMediaContainer()` / equivalent supported creation operation
- `publishPost()`
- `listReplies()` / equivalent supported engagement operation
- `getInsights()` / equivalent supported metrics operation

Exact endpoint names, permissions, fields, and supported operations must be verified against the current Meta/Threads documentation during implementation. Do not hard-code assumptions from the old tester.

## Phase 1 verified provider contract

Verified against Meta's official Threads documentation on 2026-09-11:

- Authorization window: `https://threads.com/oauth/authorize`
- Required Phase 1 permission: `threads_basic`
- Authorization-code exchange: `POST https://graph.threads.com/oauth/access_token`
- Long-lived token exchange: `GET https://graph.threads.com/access_token` with `grant_type=th_exchange_token`
- Connected app-scoped profile: `GET https://graph.threads.com/v1.0/me?fields=id,username,name`

Provider URLs and API version remain behind the server adapter/configuration boundary. Phase 1 does not request publishing, reply, discovery, or insights permissions.

## Error handling

Map provider errors into stable application errors with:

- capability/operation
- provider status/code when safe
- user-readable explanation
- retryability

Never return access tokens, App Secret, or authorization codes to the UI.
