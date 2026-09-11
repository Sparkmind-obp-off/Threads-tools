# 06 — Testing and Delivery

## Test layers

1. Config validation: missing/invalid environment values fail safely.
2. OAuth: state mismatch, callback error, token exchange success/failure.
3. API client: success, permission denial, rate limit, malformed response, timeout.
4. Normalizers: provider payloads map to stable application objects.
5. UI: dashboard, posts, compose, engagement, insights, connection states.
6. E2E: connect account in a safe environment and publish a real test post.

## Phase 1 acceptance checklist

- [x] Missing configuration fails safely and is visible in the UI.
- [x] OAuth initiation, callback, single-use state validation, and provider failures are covered by tests.
- [x] Account identity is normalized and browser responses exclude tokens/secrets.
- [x] Unsupported later-phase capabilities are clearly labelled.
- [x] Type checking, automated tests, and production build pass.
- [ ] A real operator-owned Threads tester/account completes OAuth in the deployed environment.

The Phase 1 gate remains `BLOCKED — configuration required` until the final real-account item is verified.

## Later-phase acceptance checklist

- [ ] Real posts load.
- [ ] Real supported engagement data loads.
- [ ] Real supported insights load.
- [ ] Real post can be created/published.

## Delivery rule

Do not call the project complete merely because an API request returns HTTP 200. The user must be able to perform the intended job through the actual UI.
