# 09 — Genspark Phase 2 Master System Prompt

## Mission

You are implementing **Phase 2 — Read** of the real **Threads Tools** application.

This is **not** an API tester/explorer. It is a small, real operator console for the user's own Threads professional/personal-brand account.

Phase 1 established the secure application foundation and Threads connection flow. Phase 2 now turns that connection into **real read-only operational data**.

## Mandatory context

Before changing code:

1. Read `README.md`.
2. Read `docs/01_PRODUCT_REQUIREMENTS.md` through `docs/08_GENSPARK_PHASE_1_MASTER_SYSTEM_PROMPT.md`.
3. Inspect the existing implementation and preserve working Phase 1 behavior.
4. Verify the **current official Threads API contract** before implementing endpoints, fields, permissions, pagination, or insights. Do not blindly reuse old tester code or outdated tutorials.

## Phase 2 scope

Implement only the Read layer:

- Connected account identity/details that are actually supported.
- Fetch the authenticated account's Threads posts.
- Normalize provider responses into stable application models.
- Display real posts in the dashboard/posts area.
- Fetch and display engagement/replies/comments only where the current API and granted permissions support them.
- Fetch and display supported insights/metrics only where currently available.
- Handle pagination where relevant.
- Handle expired/invalid tokens and provider errors safely.
- Clearly distinguish `supported`, `unsupported`, `not_configured`, `empty`, `loading`, and `error` states.

Do **not** implement Phase 3 publishing in this task.

Do **not** implement DMs, automated replies, bulk engagement, Instagram, Make.com, multi-user SaaS, or demand intelligence in this task.

## Product UX

Keep the existing clean operator-dashboard direction.

### Dashboard
Show, using real data only:

- Connection status.
- Connected Threads username/display name when available.
- Recent posts.
- A concise engagement summary when supported.
- A concise insights/metrics summary when supported.
- Clear capability/status notices.

No fake counters, placeholder engagement, fabricated comments, or demo data in production mode.

### Posts
Create a useful read-only post list/detail experience containing only supported data, for example:

- post ID
- timestamp
- text/content when available
- permalink when available
- media information when available
- reply/comment count when available
- like/repost/quote/view or other metrics only when actually returned by the current API

Do not invent fields that the provider does not return.

### Engagement
If supported by the current Threads API and permissions:

- list relevant replies/comments
- show author information only where permitted/available
- show timestamps/content and supported interaction metadata

If not supported, render a clear `Unsupported` state with a short explanation. Do not create fake engagement data.

### Insights
If supported:

- retrieve only currently supported metrics
- label metric names clearly
- show the measurement period/time context when available
- handle unavailable metrics individually instead of failing the whole page

If unsupported or not permitted, explain that honestly.

## Architecture requirements

Preserve the existing boundary:

**Browser → Threads Tools server → Threads/Meta API**

The browser must never receive:

- App Secret
- access token
- refresh token
- OAuth authorization code
- raw provider credentials
- unnecessary sensitive provider payloads

Provider-specific logic belongs in a server-side Threads adapter/service layer.

The UI should consume normalized application objects rather than raw provider JSON.

Suggested boundaries (adapt to the existing codebase rather than forcing a rewrite):

- `lib/threads/` — provider client and endpoint integration
- `lib/threads/normalizers/` — provider-to-app normalization
- `lib/threads/types/` — stable internal types
- `lib/config/` — existing server-only configuration validation
- server/API routes — authenticated read operations
- UI components — presentation/state handling only

## Data contracts

Use stable internal models. Example shape, adapt to actual supported fields:

```ts
interface ThreadsPost {
  id: string;
  text?: string;
  timestamp?: string;
  permalink?: string;
  mediaType?: string;
  mediaUrl?: string;
  username?: string;
  metrics?: {
    likes?: number;
    replies?: number;
    reposts?: number;
    quotes?: number;
    views?: number;
  };
}
```

Do not force unsupported metrics into the model as zero. `undefined`/absence must mean unavailable, not zero.

For capabilities, retain the project's explicit status model:

- `supported`
- `unsupported`
- `not_configured`
- `error`

Add `empty` where a valid request succeeds but no records exist.

## API integration rules

1. Verify current official Threads documentation first.
2. Confirm required permissions/scopes for each read capability.
3. Confirm current endpoint paths and required fields.
4. Confirm pagination behavior and limits.
5. Confirm which metrics/insights are currently supported.
6. Implement the smallest valid contract.
7. Normalize provider errors into safe application errors.
8. Never expose raw access tokens or secrets.
9. Never log credentials or authorization headers.
10. Do not silently substitute unsupported fields with fake values.

If the current API differs from assumptions in earlier documents, follow the current official contract and update the integration documentation accordingly.

## Authentication/session behavior

Reuse the secure Phase 1 connection/token mechanism.

Read operations must:

- require a valid connected state
- use the server-side token/session mechanism
- detect expired/invalid authorization
- return a safe re-authentication instruction when needed
- never send the token to the browser

If Phase 1 token persistence is not sufficient for read operations, improve it minimally and securely rather than creating a parallel credential system.

## Pagination

Where the provider returns pagination:

- normalize cursor/next-page information
- prevent accidental infinite loops
- expose only what the UI needs
- provide a clear Load More / pagination control where useful

Do not fetch unbounded datasets automatically.

## Error handling

Use trustworthy user-facing states:

- Not configured
- Not connected
- Unauthorized / re-authentication required
- Provider unavailable
- Unsupported capability
- Empty result
- Unexpected error

Technical details may be logged server-side only when safe and without secrets.

## Testing requirements

Add or update tests for:

### Provider client
- successful account read
- successful posts read
- pagination
- supported engagement read
- supported insights read
- provider error normalization
- unauthorized/expired token handling

### Normalizers
- valid provider payload → stable app model
- missing optional fields remain absent
- unsupported metrics are not converted to zero
- malformed provider payloads fail safely

### Security
- no token/secret in API responses
- no token/secret in rendered HTML
- no authorization header in logs
- no App Secret exposed to client code

### UI
- loading states
- empty states
- unsupported states
- error states
- real-data rendering
- pagination/load-more behavior where implemented

## Acceptance gate — Phase 2 PASS

Phase 2 is complete only when all applicable criteria below are true:

1. Phase 1 connection still works.
2. A real connected Threads account can be read from the application.
3. Real Threads posts appear in the dashboard/posts UI.
4. Returned data is normalized rather than dumped as tester-style JSON.
5. Supported engagement/replies/comments appear correctly, where the current API permits them.
6. Supported insights/metrics appear correctly, where the current API permits them.
7. Unsupported capabilities are clearly marked unsupported rather than faked.
8. Empty datasets are handled gracefully.
9. Pagination works where applicable.
10. Expired/invalid authorization produces a safe recovery state.
11. No App Secret, access token, refresh token, authorization code, or sensitive credential appears in browser responses, rendered HTML, or logs.
12. Tests pass.
13. Production build passes.
14. No Phase 3 functionality was unnecessarily introduced.

## Implementation discipline

Do not rewrite the project unnecessarily.

Prefer small, reversible changes that preserve the working Phase 1 foundation.

Do not add mock data just to make the UI look complete.

Do not claim a capability is supported unless it is verified against the current official API contract.

If a required Threads capability is blocked by API permissions/review or unavailable for the current app, keep the application functional and surface the exact limitation as a capability state.

## Required final report

At the end, report:

1. What was implemented.
2. Files/modules changed.
3. Current Threads API endpoints/permissions actually used.
4. Environment variables required (never print their secret values).
5. How to run locally.
6. How to verify with a real connected account.
7. Tests run and results.
8. Production build result.
9. Any API limitations or permission/review blockers.
10. Explicit Phase 2 gate: `PASS` or `BLOCKED`.

If blocked, state the exact blocker and the smallest next action. Do not hide a limitation behind a successful build.

## Definition of done

The operator should be able to open Threads Tools, connect through the existing secure Phase 1 flow, and then **see trustworthy real Threads data** inside the application without exposing credentials and without falling back to tester-style raw API screens.
