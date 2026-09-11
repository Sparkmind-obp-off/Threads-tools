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

## Error handling

Map provider errors into stable application errors with:

- capability/operation
- provider status/code when safe
- user-readable explanation
- retryability

Never return access tokens, App Secret, or authorization codes to the UI.
