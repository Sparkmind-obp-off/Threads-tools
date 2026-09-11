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

### Phase 3 publishing

- OAuth requests `threads_content_publish` alongside the existing read scopes.
- Text container creation and publish requests use current required fields and server-side bearer authentication.
- Publish IDs and optional post details are allow-listed and normalized.
- Empty, oversized UTF-8, malformed request IDs, and more than five unique links are rejected before provider calls.
- Not-connected and expired-authorization states are explicit.
- Container failure, definite publish rejection, rate limiting, provider outage, malformed responses, and ambiguous publish results are normalized safely.
- D1-backed request IDs prevent active duplicate submissions and replay a persisted success without another provider call.
- Ambiguous publish results are not marked safe-to-retry and are never blindly republished.

### Phase 4 operator polish

- Dashboard connected/disconnected, warning, empty, provider error, and reauthorization-oriented states.
- Bounded loaded-post search/sort and preserved cursor pagination.
- Real post detail with missing optional fields and verified permalink-only action.
- Selected-post engagement context and top-level-only reply capability states.
- Valid 7/14/30-day current/previous account metric comparisons; unavailable metrics remain absent.
- Safe audit event allow-listing and bounded cursor pagination; sensitive extra fields are dropped.

### Phase 5 personal access and onboarding

- Dashboard, Posts, Insights, and other operator pages render without an in-app password gate.
- The obsolete session/password API returns Not Found.
- First-run setup and locally completed setup behavior are present without storing secrets.
- Configuration readiness exposes status values only.
- Connected, disconnected, and expired/reconnect states are covered.
- OAuth state validation, encrypted token persistence, provider-side calls, and Phase 1–4 regression coverage remain intact.

### UI and client security

- Dashboard, Posts, Compose, Engagement, Insights, and Settings shells render.
- Compose includes byte count, client validation, preview, connected-account identity, publishing lock, success/error states, and an honest unsupported-media explanation.
- Loading, empty, unsupported, error, and Load More states are present.
- Server-only environment names, access tokens, refresh tokens, OAuth codes, and provider Authorization headers are not shipped in browser assets.

## Manual real-account verification

1. Configure all server secrets and apply the D1 migration.
2. Add the exact callback URL in Meta App Dashboard.
3. Ensure the account is a Threads Tester while the app is in development and accept the invitation.
4. Open `/setup`, verify safe readiness states, and connect/reconnect the account without an application password.
5. Confirm the authorization window requests `threads_basic`, `threads_content_publish`, `threads_read_replies`, and `threads_manage_insights` only.
6. Open `/compose`; verify the connected account, byte count, validation, preview, and unsupported-media explanation.
7. Publish one unique text post explicitly and confirm Threads returns a real post ID. Verify permalink/timestamp only appear when the provider returns them.
8. Open `/posts` and confirm the newly published real post is readable through the Phase 2 layer.
9. Open `/`, `/posts`, `/engagement`, and `/insights`; verify existing read behavior and pagination remain intact.
10. Verify replies and insights render when permissions are granted; otherwise verify an honest Unsupported state.
11. Inspect browser network responses, rendered HTML, and logs for absence of access tokens, refresh tokens, authorization codes, App Secret, and provider authorization headers.
12. Search/sort the bounded loaded post set, open a real post detail, and move to contextual engagement.
13. Compare a supported account metric over 7 days and verify the two displayed periods match provider results.
14. Inspect Activity and confirm only safe connection/publish metadata is present.
15. Attempt a double click while publishing and confirm only one publish request is active.
16. Expire/revoke the token and verify a safe reconnect instruction appears.

## Phase gates

Phase 1 remains dependent on a successful operator-owned real OAuth connection.

Phase 5 implementation passes automated checks only after all tests, typecheck, and production build pass. The final product gate remains `BLOCKED` until deployment-level private access is confirmed and a real connected account verifies onboarding, read, insights, engagement, and preserved publishing in the deployed environment. App secrets, callback configuration, tester role/App Review, permission grants, and provider access are external dependencies.
