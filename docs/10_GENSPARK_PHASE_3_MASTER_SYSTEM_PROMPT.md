# GENSPARK MASTER SYSTEM PROMPT — PHASE 3: PUBLISH

## Mission

Implement **Phase 3 — Publish** for the real `Threads Tools` application.

This is **not** an API tester/explorer. The application must become a real, secure operator console that allows the authenticated account owner to compose and publish real Threads content.

Phase 0, Phase 1 (Connection), and Phase 2 (Read) are the existing foundation. Preserve them. Do not rewrite working functionality unnecessarily.

Before changing code, read these repository documents in full:

- `README.md`
- `docs/01_PRODUCT_REQUIREMENTS.md`
- `docs/02_ARCHITECTURE.md`
- `docs/03_UX_UI_BLUEPRINT.md`
- `docs/04_API_INTEGRATION_CONTRACT.md`
- `docs/05_SECURITY_AND_SECRETS.md`
- `docs/06_TESTING_AND_DELIVERY.md`
- `docs/07_ROADMAP_AND_PHASES.md`
- `docs/08_GENSPARK_PHASE_1_MASTER_SYSTEM_PROMPT.md`
- `docs/09_GENSPARK_PHASE_2_MASTER_SYSTEM_PROMPT.md`

Treat those documents as the product contract unless this Phase 3 prompt explicitly extends them.

---

# 1. PHASE 3 OBJECTIVE

Turn the existing read-only Threads console into a real publishing workflow.

The operator must be able to:

1. Open the Compose area.
2. Write a Threads post.
3. See validation and character/count feedback.
4. Review a clear preview before publishing.
5. Explicitly click Publish.
6. Have the server create the required Threads media/container using the **current official Threads API contract**.
7. Publish the content using the current official Threads API contract.
8. Receive a trustworthy success result.
9. See the resulting post identifier/permalink/timestamp when actually returned or available.
10. Handle failures without exposing credentials or misleading the operator.
11. Refresh/read the published post through the existing Phase 2 read layer when appropriate.

The central success criterion is:

> A real connected Threads account can publish a real post from the Threads Tools UI, securely and without fake data.

---

# 2. CRITICAL API VERIFICATION RULE

**Do not blindly copy endpoint names, parameters, scopes, or media behavior from old tester code or stale documentation.**

Before implementation, verify the current official Meta/Threads API documentation and the actual contract required by the application.

Verify at minimum:

- current API version
- publishing permission/scope
- required OAuth scopes
- text-post creation flow
- container/media creation requirements
- publishing endpoint
- required fields
- supported media types
- media URL requirements
- expiration/status behavior of containers where applicable
- current error responses
- rate limits/restrictions relevant to publishing

Use only capabilities that are actually supported by the current API and permissions.

If the current API differs from the existing Phase 2 assumptions, follow the current official contract and update `docs/04_API_INTEGRATION_CONTRACT.md` accordingly.

Never invent an endpoint or claim support merely because a tester previously showed it.

---

# 3. PHASE 3 SCOPE

## Implement

### A. Compose

Create or complete the Compose page/route.

Minimum UI:

- post text input/editor
- character/count feedback based on the current Threads contract
- validation feedback
- preview
- Publish button
- loading/publishing state
- success state
- error state
- clear indication of the currently connected account

The UI must prevent accidental duplicate clicks while a publish request is active.

### B. Text Publishing

Implement the smallest reliable publishing path first:

`Compose → Validate → Server → Create required Threads container/media → Publish → Normalize result → UI`

Text-only publishing should be implemented if supported by the current official API.

### C. Media Publishing

Only implement media types that are currently verified as supported by the official API and that can be handled correctly by this application's architecture.

Do not create fake upload controls for unsupported media.

If media support is not yet practical or requires additional external configuration, show a truthful `unsupported` or `not_configured` state and keep text publishing functional.

Do not pretend an arbitrary local file can be uploaded directly if the provider requires a publicly reachable media URL or another specific mechanism.

### D. Publish Result

Normalize provider responses into an application-level publish result, for example:

```ts
interface PublishResult {
  status: "published" | "error";
  postId?: string;
  permalink?: string;
  timestamp?: string;
  message?: string;
}
```

Adapt this to the existing domain conventions rather than introducing unnecessary parallel models.

Only show fields that are actually available.

### E. Error Handling

Handle at least:

- not configured
- not connected
- authorization expired/invalid
- missing publish permission
- validation failure
- provider rejection
- rate limit
- provider unavailable
- unsupported capability
- container creation failure
- publish failure
- unexpected internal error

Technical details may be logged server-side in a safe form, but never expose secrets, access tokens, refresh tokens, OAuth codes, authorization headers, or sensitive provider payloads to the browser.

---

# 4. SECURITY REQUIREMENTS — NON-NEGOTIABLE

The existing security model remains mandatory.

## Browser must NEVER receive:

- `THREADS_APP_SECRET`
- access token
- refresh token
- OAuth authorization code
- Authorization header
- server-side credential material
- unnecessary raw provider authentication payloads

The browser may receive only normalized application results required to render the UI.

## Server must:

- reuse the existing secure Phase 1/2 authentication/session mechanism
- obtain the authenticated connection server-side
- send provider credentials only server-to-provider
- never put tokens in query parameters
- never log tokens or authorization headers
- normalize provider errors before returning them to the browser
- validate all incoming publish data
- enforce the connected-account requirement

Do not create a second credential system just for publishing.

Do not move secrets into client-side environment variables.

Do not create `NEXT_PUBLIC_*` versions of server secrets.

---

# 5. DUPLICATE-PUBLISH PROTECTION

Publishing is a side-effect and must be treated carefully.

Implement reasonable duplicate protection using the existing architecture.

At minimum:

- disable the Publish button while a request is in progress
- prevent accidental double submission from repeated clicks
- avoid retrying a publish blindly after an ambiguous provider response
- if the provider/API offers an idempotency mechanism, use it appropriately
- if the provider does not provide idempotency, design the client/server flow so an uncertain result is not automatically republished

Do not create a sophisticated job queue unless the existing architecture genuinely requires it for the current Phase 3 scope.

---

# 6. VALIDATION

Validate on both client and server.

Client validation is for UX.

Server validation is authoritative.

Validate according to the current official Threads publishing contract, including where applicable:

- non-empty content
- maximum allowed text length
- unsupported combinations of text/media/options
- required media fields
- invalid URLs where relevant
- malformed request payloads

Do not hard-code an outdated limit if the current official API contract says otherwise.

Return structured validation errors suitable for the UI.

---

# 7. UX REQUIREMENTS

Keep the existing operator-console visual language.

Compose should feel like an actual tool, not a developer test screen.

Recommended flow:

```text
Compose
  ↓
Write content
  ↓
Validation / count
  ↓
Preview
  ↓
Publish
  ↓
Publishing...
  ↓
Published / Error
```

### Success state

Show:

- clear confirmation that the post was published
- post ID if available
- permalink if available
- timestamp if available
- useful action such as `View Post` when a verified permalink exists
- option to return to Compose or Posts

### Error state

Show:

- what failed in plain language
- whether reconnect/permission/configuration is required
- safe retry guidance where appropriate
- no secret/token/provider-auth payload

### Loading state

The operator must understand that publishing is in progress.

Do not allow duplicate submission during the active request.

---

# 8. ARCHITECTURE

Preserve the existing architecture:

```text
Browser UI
   ↓
Threads Tools Server
   ↓
Threads Adapter / Service
   ↓
Official Threads API
```

Suggested responsibilities:

- `src/threads/adapter.ts` or equivalent: provider communication
- `src/threads/normalizers.ts`: provider → application models
- `src/services/` or equivalent: publishing business logic
- existing auth/storage modules: secure connection/token retrieval
- Compose UI: input, validation feedback, preview, result states

Do not put provider-specific authentication logic inside presentation components.

Do not let UI components call the Threads API directly.

Do not return raw provider payloads when a normalized model is sufficient.

---

# 9. PUBLISH SERVICE CONTRACT

Create or extend a server-side publishing service with a clear contract.

Conceptually:

```ts
publishPost(input) -> PublishResult
```

The service should:

1. verify application configuration
2. verify an authenticated Threads connection
3. retrieve the server-side token/credential securely
4. validate normalized input
5. create the required provider-side container/media
6. publish using the current provider contract
7. normalize the result
8. return only safe application data

If the provider requires a polling/status step before publishing, implement only what the current official contract requires.

---

# 10. CONFIGURATION

Reuse the Phase 1 configuration model.

Do not ask the operator to paste secrets into the Compose page.

Settings should continue to show safe configuration status only.

If Phase 3 requires a new environment variable or scope, document it by name only.

Never put the actual secret value into:

- source code
- GitHub
- prompts
- README examples
- test fixtures
- browser responses
- logs

If a new publish-specific configuration is required, update `.env.example` with a placeholder only.

---

# 11. OAUTH / PERMISSIONS

Publishing may require a permission/scope that was not needed by Phase 2.

Determine the exact current permission from official Meta/Threads documentation.

If reconnecting is required to obtain the new permission:

- preserve the existing OAuth flow
- request only the required additional scope(s)
- preserve secure OAuth state validation
- do not create a separate authentication flow

If the application is still in development and only tester accounts can publish, document that limitation clearly.

If Meta App Review/public publishing is required, report it as an external dependency rather than weakening the security model.

---

# 12. TESTING

Add or update tests for the complete publishing path.

Minimum test coverage:

### Provider adapter

- correct create-container/media request
- correct publish request
- current required fields
- provider success response
- provider validation error
- unauthorized/expired token
- permission error
- rate-limit error
- provider unavailable

### Service

- not configured
- not connected
- invalid input
- successful publish
- container failure
- publish failure
- ambiguous provider result
- duplicate-submission protection where testable

### Normalizers

- valid publish response
- missing optional fields
- malformed response handled safely
- no fake permalink/id/timestamp

### Security

Explicitly test that:

- App Secret is absent from API responses
- access/refresh tokens are absent from API responses
- OAuth code is absent from API responses
- Authorization headers are not exposed to browser-visible output
- secrets are not rendered into HTML
- secrets are not included in normal logs

### UI

Test:

- empty compose state
- validation error
- valid compose state
- publishing state
- duplicate-click prevention
- success state
- error state
- unsupported media state where applicable
- reconnect-required state

Do not rely exclusively on mocked success tests. The implementation must be designed for real provider verification.

---

# 13. REGRESSION REQUIREMENTS

Phase 3 must not break Phase 1 or Phase 2.

Verify that these still work:

- operator authentication/session
- Settings / configuration status
- Threads OAuth connection
- connected account identity
- Dashboard
- Posts
- pagination
- Engagement where supported
- Insights where supported
- safe error states

No regression should expose credentials.

---

# 14. STRICT NON-GOALS

Do NOT implement these in Phase 3:

- automated replies
- bulk engagement
- spam/engagement bots
- DMs
- automatic commenting
- scheduled posting unless already required by the current product contract
- Instagram integration
- Facebook integration
- TikTok integration
- Make.com integration
- multi-user SaaS
- team/tenant management
- demand intelligence
- opportunity database
- lead scoring
- autonomous AI operator
- mass publishing
- hidden/background auto-publishing

Phase 3 is specifically **Publish**.

Keep the implementation narrow.

---

# 15. REAL-DATA RULE

Production UI must never use fake publishing success.

Never show:

- fake post IDs
- fake permalinks
- fake timestamps
- fake success counters
- fake provider responses

If real provider verification is impossible because production credentials, scopes, tester access, or App Review are not available, clearly distinguish:

- `IMPLEMENTATION COMPLETE`
- `REAL-WORLD VERIFICATION BLOCKED`

Do not call the Phase 3 gate PASS without a real successful publish verification.

---

# 16. DOCUMENTATION UPDATES

If implementation changes the API contract, update:

- `docs/04_API_INTEGRATION_CONTRACT.md`
- `docs/06_TESTING_AND_DELIVERY.md`
- `docs/07_ROADMAP_AND_PHASES.md`
- `README.md` where appropriate

Document:

- exact current endpoints actually used
- exact scopes/permissions actually required
- required fields
- supported content/media types
- known limitations
- external verification/App Review requirements

Do not document guessed API behavior as fact.

---

# 17. IMPLEMENTATION DISCIPLINE

Follow these rules:

1. Inspect the existing code before modifying it.
2. Reuse working Phase 1/2 modules.
3. Prefer small, reversible changes.
4. Do not perform an unnecessary framework rewrite.
5. Do not replace the secure auth/session mechanism.
6. Do not expose secrets for convenience.
7. Do not add fake functionality to make the demo look complete.
8. Do not expand into Phase 4/5.
9. Keep provider-specific logic server-side.
10. Verify current official Threads API behavior before implementation.
11. Run tests and production build before reporting completion.
12. If blocked, report the exact blocker instead of masking it.

---

# 18. DEFINITION OF DONE

Phase 3 is implementation-complete when:

- Compose UI exists and is usable.
- Text validation works.
- Publish request is server-side and secure.
- Current official Threads publish contract is implemented.
- Required container/media creation works where applicable.
- Publish operation works where permissions allow.
- Result is normalized.
- Success/error/loading states are trustworthy.
- Duplicate clicks are prevented.
- No secrets/tokens/auth codes are exposed.
- Existing Phase 1/2 functionality remains intact.
- Tests pass.
- Typecheck passes.
- Production build passes.
- Documentation reflects the actual implementation.

---

# 19. PHASE 3 ACCEPTANCE GATE

### PASS

Mark Phase 3 `PASS` only if all of the following are true:

1. A real Threads account is connected.
2. Required publish permission/scope is actually available.
3. Operator can compose a valid post in the UI.
4. Operator can explicitly publish it.
5. Threads accepts the publish request.
6. A real post is created on Threads.
7. The application shows a trustworthy result.
8. Existing read functionality can still operate.
9. No App Secret/access token/refresh token/OAuth code is exposed.
10. Tests pass.
11. Typecheck passes.
12. Production build passes.
13. No unnecessary Phase 4/5 functionality was introduced.

### BLOCKED

Mark Phase 3 `BLOCKED` if implementation is complete but real verification cannot be performed because of:

- missing production secrets
- missing/incorrect redirect configuration
- missing publishing scope
- Threads tester restrictions
- Meta App Review requirements
- provider/API availability
- another external dependency

In that case report:

- what is implemented
- exact external blocker
- what the operator must configure later
- what has and has not been verified

Do not ask the operator to paste secrets into GitHub, Genspark, or chat.

---

# 20. FINAL GENSPARK REPORT FORMAT

At the end, return a concise implementation report with exactly these sections:

## 1. IMPLEMENTED

List the Phase 3 capabilities completed.

## 2. FILES / MODULES CHANGED

List important files and why they changed.

## 3. CURRENT THREADS API CONTRACT USED

State:

- API version
- endpoints
- scopes/permissions
- required fields
- media capabilities

Only state what was actually verified.

## 4. ENVIRONMENT REQUIREMENTS

List environment variable names only.

Never output secret values.

## 5. LOCAL RUN

Give the exact commands needed to run/test the app locally.

## 6. REAL ACCOUNT VERIFICATION

State whether a real Threads publish was successfully verified.

If not, explain the exact blocker.

## 7. TESTS / TYPECHECK / BUILD

Report exact results.

## 8. LIMITATIONS / EXTERNAL BLOCKERS

List API, permission, review, or platform limitations.

## 9. PHASE 3 GATE

Return exactly one:

`PASS`

or

`BLOCKED`

with a one-paragraph explanation.

---

# FINAL INSTRUCTION

**GAS PHASE 3 ONLY.**

Build the real publishing workflow into the existing `Threads Tools` application.

Do not turn this into a tester.

Do not expose credentials.

Do not invent unsupported API capabilities.

Do not implement automation, Instagram, Make.com, DMs, demand intelligence, or later phases.

Verify the current official Threads API contract first, implement the smallest reliable publish path, test it thoroughly, and report the exact Phase 3 gate honestly.