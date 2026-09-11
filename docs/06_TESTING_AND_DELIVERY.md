# 06 — Testing and Delivery

## Automated quality gate

Run:

```bash
npm run typecheck
npm test
npm run build
```

## Current automated coverage

### Configuration and Phase 1

- Missing/invalid environment values fail safely.
- OAuth state is cryptographically sized and single-use.
- Authorization cancellation, invalid state, token exchange failure, and account lookup failure are normalized.
- Safe connection objects do not expose credentials.

### Phase 2 provider client

- Account read and allow-listed normalization.
- Posts read with cursor pagination.
- Reply read using the supported top-level endpoint.
- Post and account insights contracts.
- Bearer tokens stay in server-to-provider authorization headers and do not enter provider URLs.
- Permission denial, provider failure, and expired token normalization.

### Normalizers

- Valid provider post/metric payloads map to stable application models.
- Unknown fields are dropped.
- Missing optional fields remain absent.
- Missing metric values are not converted to zero.
- Malformed records and page payloads fail safely.

### Read service

- Connected-state requirement.
- Successful account/posts reads.
- Pagination cursor forwarding and bounds.
- Explicit supported/empty/unsupported/error states.
- Invalid media IDs rejected before provider calls.
- Expired authorization produces a reconnect state.

### UI and client security

- Dashboard, Posts, Engagement, Insights, and Settings shells render.
- Loading, empty, unsupported, error, and Load More states are present.
- Server-only environment names, access tokens, and provider Authorization headers are not shipped in browser assets.

## Manual real-account verification

1. Configure all server secrets and apply the D1 migration.
2. Add the exact callback URL in Meta App Dashboard.
3. Ensure the account is a Threads Tester while the app is in development and accept the invitation.
4. Sign in at `/settings` and reconnect the account.
5. Confirm the authorization window requests `threads_basic`, `threads_read_replies`, and `threads_manage_insights` only.
6. Open `/`, `/posts`, `/engagement`, and `/insights`.
7. Verify owned posts match Threads and Load More works when another cursor is returned.
8. Verify replies and insights render when permissions are granted; otherwise verify an honest Unsupported state.
9. Inspect browser network responses and rendered HTML for absence of access tokens, authorization codes, App Secret, and provider authorization headers.
10. Expire/revoke the token and verify a safe reconnect instruction appears.

## Phase gates

Phase 1 remains dependent on a successful operator-owned real OAuth connection.

Phase 2 implementation passes automated checks only after all tests and production build pass. The final product gate is `BLOCKED` until a real connected account verifies owned posts and any granted reply/insights capabilities in the deployed environment.
