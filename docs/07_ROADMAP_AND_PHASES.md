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

## Phase 5 — Personal operator onboarding and controlled expansion

Phase 5 starts with a **private-first personal operator experience**. It does not turn Threads Tools into a SaaS product.

### Phase 5 required scope

1. **Remove the mysterious operator-password gate.**
   - Do not require a separate app/operator password before opening Dashboard, Posts, Insights, or other existing operator features.
   - Do not invent a default password and do not ask the user to discover or recover an undocumented password.
   - Preserve the existing OAuth/session/security model and server-side secret boundaries.
   - If additional access control is needed because the deployment is public, use/document deployment-level protection rather than an in-app mystery password.

2. **Add lightweight personal onboarding.**
   - First launch provides a short setup flow for the single owner/operator.
   - Show configuration readiness as safe `Configured` / `Missing` states; never display `THREADS_APP_SECRET` or access/refresh tokens in the browser.
   - Let the operator connect the Threads account through the existing OAuth flow.
   - Explain only the minimum setup needed.
   - After successful setup, go directly to the operator dashboard.
   - Do not repeat onboarding on every visit; provide Settings/Setup for later review.

3. **Personal-only boundary.**
   - One operator / one private workspace.
   - No registration, organizations, teams, invites, billing, roles, tenant switching, or SaaS onboarding.

4. **Preserve existing functionality.**
   - Dashboard, Posts, Post Detail, Engagement, Insights, Compose/Publish, Settings, and safe audit visibility remain available.
   - Do not weaken OAuth, token handling, state validation, server boundaries, or secret handling merely to remove the password gate.

### Phase 5 controlled expansion

After the onboarding/access cleanup is stable, Phase 5 may prepare a controlled foundation for future personal activity context. Do **not** implement Instagram, demand intelligence, autonomous behavior, bulk engagement, DMs, or other future systems in this pass unless separately approved.

### Phase 5 non-goals

- No SaaS conversion.
- No multi-user/team/tenant system.
- No billing.
- No public self-service onboarding.
- No hidden/default operator password.
- No credential exposure in UI.
- No automated replies/comments/likes.
- No bulk engagement or mass publishing.
- No DMs.
- No Instagram/Facebook/TikTok integration yet.
- No demand-intelligence/opportunity database implementation yet.
- No autonomous AI agent behavior.

**Gate:** Phase 5 is PASS when the personal first-run setup is clear, the undocumented/mysterious operator password gate is removed without weakening security, existing Threads OAuth/read/publish functionality remains intact, tests/typecheck/build pass, and no future expansion is accidentally implemented outside this scope.

**External dependencies:** production Threads configuration, OAuth grants, provider availability, and any deployment-level access-control configuration used to keep this personal tool private.
