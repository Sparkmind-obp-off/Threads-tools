# 06 — Testing and Delivery

## Test layers

1. Config validation: missing/invalid environment values fail safely.
2. OAuth: state mismatch, callback error, token exchange success/failure.
3. API client: success, permission denial, rate limit, malformed response, timeout.
4. Normalizers: provider payloads map to stable application objects.
5. UI: dashboard, posts, compose, engagement, insights, connection states.
6. E2E: connect account in a safe environment and publish a real test post.

## Acceptance checklist

- [ ] OAuth connection works.
- [ ] Account identity loads.
- [ ] Real posts load.
- [ ] Real supported engagement data loads.
- [ ] Real supported insights load.
- [ ] Real post can be created/published.
- [ ] Unsupported capabilities are clearly labelled.
- [ ] No secrets appear in browser source, logs, or repository.
- [ ] Production build passes.

## Delivery rule

Do not call the project complete merely because an API request returns HTTP 200. The user must be able to perform the intended job through the actual UI.
