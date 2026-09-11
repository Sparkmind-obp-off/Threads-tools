# 07 — Roadmap and Phase Gates

## Phase 0 — Foundation

Documentation, repository hygiene, environment contract, and architecture.

**Status:** implemented.

## Phase 1 — Connection

OAuth, secure server configuration, encrypted token persistence, account status, and safe errors.

**Gate:** a real Threads account connects successfully in the configured deployment.

## Phase 2 — Read

Implemented read-only account identity, owned post retrieval, cursor pagination, top-level reply retrieval when permitted, account/post insights when permitted, normalized models, and explicit capability/error/empty states.

**Gate:** the deployed dashboard shows real provider data without raw tester-style payloads and without credential exposure.

**External dependencies:** existing Phase 1 connections must reconnect for Phase 2 scopes. Non-tester/public users require Meta App Review approval and a published app for `threads_read_replies` and `threads_manage_insights`.

## Phase 3 — Publish

Implemented: authenticated Compose UI, current 500 UTF-8-byte text validation, five-link limit validation, preview, explicit publish action, connected-account identity, server-side text container creation, publish operation, safe result enrichment, D1-backed duplicate-request protection, and trustworthy loading/success/error/unsupported-media states.

**Content scope:** text-only. The official API also supports image, video, and carousel posts, but those require publicly reachable provider-fetchable media plus processing behavior that is not configured in this console. No fake local upload control is exposed.

**Gate:** automated implementation checks must pass and a real connected Threads account with `threads_content_publish` must create a real post. Until that real-world publish is verified, the product gate is `BLOCKED` rather than `PASS`.

**External dependencies:** production Threads secrets and callback URI, Threads Tester access while the app is in development or Meta App Review plus a published app for non-role users, and a fresh OAuth grant containing `threads_content_publish`.

## Phase 4 — Operator polish

Implemented: operator-health dashboard, bounded loaded-post search and chronological sort, real post detail, selected-post engagement context, supported 7/14/30-day account metric comparison, consistent capability/reauthorization states, and D1-backed safe operational audit visibility.

**Gate:** automated tests, typecheck, migration, and build must pass, then a deployed real connected Threads account must verify dashboard data, post detail, engagement, ranged insights, activity events, and preserved publishing. Without production credentials/account access, the implementation can be complete while the product gate remains `BLOCKED`.

**External dependencies:** production Threads configuration, current OAuth grants, applicable App Review/tester access, provider availability, and a real account with data needed to verify each supported state.

## Phase 5 — Future expansion

Only after Threads Tools is stable: separate personal daily-activity context, other channels such as Instagram, and demand-intelligence features. These remain outside the current product boundary.
