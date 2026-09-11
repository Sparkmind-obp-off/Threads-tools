# GENSPARK MASTER SYSTEM PROMPT — PHASE 4: OPERATOR POLISH

## Mission

Implement **Phase 4 — Operator Polish** for the real `Threads Tools` application.

This is not a tester/explorer and not a new product. It is the next usability and operational layer on top of the existing Phase 1 Connection, Phase 2 Read, and Phase 3 Publish foundation.

Preserve working functionality. Do not rewrite the architecture unnecessarily.

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
- `docs/10_GENSPARK_PHASE_3_MASTER_SYSTEM_PROMPT.md`

Treat them as the product contract unless this Phase 4 prompt explicitly extends them.

---

# 1. PHASE 4 OBJECTIVE

Turn the existing functional Threads console into a more efficient **daily operator console**.

The operator should be able to:

1. Quickly understand account and connection health.
2. Find posts without manually scanning an unstructured list.
3. Open useful post detail views.
4. Inspect available engagement/replies in context.
5. Compare supported metrics over useful periods where the API actually permits it.
6. See capability, empty, error, and reauthorization states clearly.
7. Understand recent publishing activity without inventing data.
8. Inspect a safe operational/audit trail where existing architecture supports it.
9. Move between dashboard, posts, engagement, insights, and compose with minimal friction.

The central success criterion is:

> The owner can use Threads Tools as a practical daily operating console instead of merely a collection of API-backed pages.

Phase 4 is **polish and operational usability**, not autonomous automation.

---

# 2. CRITICAL SCOPE RULE

Do not expand into future product areas.

Phase 4 may improve existing Threads capabilities and organize existing real data, but must not introduce:

- autonomous AI agents
- automated commenting
- automated replies
- bulk engagement
- DMs
- mass publishing
- hidden/background publishing
- Instagram/Facebook/TikTok integrations
- Make.com integration
- demand intelligence
- opportunity database
- lead scoring
- multi-user SaaS
- team/tenant management
- a new credential system

If a requested feature requires a new provider capability that is not already verified, mark it `unsupported` rather than guessing.

---

# 3. PHASE 4 WORKSTREAMS

## A. Dashboard / Operator Home

Improve the dashboard so it answers, at a glance:

- Is the Threads account connected?
- Is configuration healthy?
- Is reauthorization required?
- What are the latest posts?
- What recent engagement/metrics are actually available?
- Are there provider/API warnings?
- Can the operator immediately compose a post?

Use real provider data only.

Do not manufacture health scores, engagement numbers, activity counts, or recommendations that are not backed by actual data.

---

## B. Post List Improvements

Improve `/posts` with practical operator controls where supported by the existing data:

- search/filter by post text
- chronological sorting
- pagination / Load More using existing provider pagination
- compact engagement summary where metrics exist
- media/type indicators based on real data
- clear empty state
- clear loading state
- clear error state

Do not fetch an unbounded amount of provider data merely to support local UI filtering.

If server-side filtering is not available, filter only the already-loaded bounded dataset and label the behavior appropriately.

---

## C. Post Detail

Create or improve a useful post-detail view.

Show only information actually returned or safely derivable:

- post ID
- text
- timestamp
- permalink
- media type/details where available
- available metrics
- available top-level replies
- provider capability notices
- publish metadata where the application already stores it

Useful actions may include:

- View on Threads, only when a verified permalink exists
- Refresh data
- Open engagement
- Return to posts

Never invent a permalink.

---

## D. Engagement Workflow

Improve `/engagement` so replies/comments can be inspected in the context of the selected post.

Where the current API supports only top-level replies, keep the UI explicit about that limitation.

The UI should distinguish:

- supported
- unsupported
- empty
- loading
- error
- reauthorization required

Do not add replying, commenting, liking, or other mutation actions unless they were already part of the verified product contract. Phase 4 remains read-oriented for engagement.

---

## E. Insights / Metric Comparison

Improve `/insights` using only metrics verified by the current official Threads API contract.

Where the API supports historical or period-based insight queries, provide a practical comparison such as:

- selected period
- previous period
- metric-by-metric comparison

Only show comparisons when the underlying data is actually available and comparable.

Never convert unavailable metrics to zero.

Never infer unsupported metrics from unrelated values.

For example, if `views` is unavailable, display `Unavailable` rather than `0`.

Clearly identify the time period represented by each metric.

Do not build a fake analytics engine.

---

## F. Safe Operational Audit Visibility

If the existing architecture already has an audit/log concept, expose a **safe operator-facing activity history** for meaningful application events such as:

- OAuth connection/reconnection
- publish attempt
- publish success
- publish failure
- configuration status change where already tracked
- provider/auth errors

Do not expose:

- access tokens
- refresh tokens
- App Secret
- OAuth codes
- Authorization headers
- raw credentials
- sensitive provider payloads

Audit entries should contain only safe metadata such as:

- event type
- timestamp
- outcome
- safe resource identifier
- safe error category

If no safe audit persistence exists, implement the smallest reasonable mechanism consistent with the current architecture. Do not create a complex logging platform.

---

# 4. UX PRINCIPLES

The product should feel like an operator tool, not a developer console.

Use the existing visual language and avoid unnecessary redesign.

Prioritize:

- fast scanning
- clear hierarchy
- predictable navigation
- meaningful empty states
- explicit capability states
- useful error messages
- responsive desktop-first behavior
- accessible controls
- keyboard-friendly forms where practical

Avoid visual noise and dashboard decoration that does not help the operator act.

---

# 5. GLOBAL STATE MODEL

Preserve and consistently use the application's existing capability/state model.

At minimum support where relevant:

- `supported`
- `unsupported`
- `not_configured`
- `empty`
- `loading`
- `error`
- `reauthorization_required`

Do not use `0`, empty strings, fake placeholder objects, or fabricated records to represent unavailable provider data.

The UI should explain the difference between:

- there is genuinely no data
- the capability is unsupported
- configuration is missing
- the user must reconnect
- the provider returned an error

---

# 6. PERFORMANCE

Phase 4 should improve perceived and actual usability without creating excessive provider traffic.

Requirements:

- reuse existing server-side data boundaries
- avoid duplicate API calls from multiple UI components
- avoid unbounded pagination
- preserve cursor pagination
- do not repeatedly refetch unchanged data without reason
- use sensible loading states
- keep the worker/server bundle reasonable
- avoid introducing a heavy client framework solely for polish

Any caching must respect the freshness requirements of Threads data and must never cache secrets.

---

# 7. SECURITY — NON-NEGOTIABLE

All Phase 1–3 security rules remain mandatory.

The browser must never receive:

- `THREADS_APP_SECRET`
- access tokens
- refresh tokens
- OAuth authorization codes
- Authorization headers
- server credentials
- unnecessary raw authentication payloads

Do not expose secrets through:

- HTML
- JavaScript bundles
- API responses
- client-side storage
- query parameters
- logs
- audit entries

Reuse the existing secure auth/session/token storage mechanism.

Do not create a second credential system.

---

# 8. REAL-DATA RULE

Production UI must use real data only.

Never create fake:

- posts
- replies
- metrics
- timestamps
- post IDs
- permalinks
- audit outcomes
- connection states
- engagement totals

If a capability cannot be verified or is unavailable for the connected account, represent that honestly.

---

# 9. API VERIFICATION RULE

Before implementing any new provider-facing behavior:

1. Verify the current official Meta/Threads documentation.
2. Confirm the endpoint.
3. Confirm permissions/scopes.
4. Confirm fields and response shape.
5. Confirm pagination behavior.
6. Confirm metric availability.
7. Confirm current API/version restrictions.

Do not assume a feature exists because an old tester or previous implementation suggested it.

If no new provider endpoint is necessary, prefer reusing the existing adapter/service layer.

---

# 10. ARCHITECTURE

Preserve the established boundary:

```text
Browser UI
   ↓
Threads Tools Server
   ↓
Threads Adapter / Services
   ↓
Official Threads API
```

Provider-specific behavior remains server-side.

UI consumes normalized application models.

Do not put direct Threads API calls into presentation components.

Suggested areas to inspect before changing code:

- `src/threads/`
- `src/services/`
- `src/domain/`
- `src/storage/`
- existing route/controller layer
- existing UI components
- existing tests

Reuse existing abstractions wherever possible.

---

# 11. TESTING

Add or update tests for Phase 4 behavior.

## Dashboard

- connected state
- disconnected state
- reauthorization required
- real recent data
- empty data
- provider error

## Posts

- search/filter behavior
- sorting
- pagination
- empty state
- loading state
- error state
- no fake records

## Post detail

- valid post
- missing optional fields
- unavailable metrics
- supported replies
- unsupported capability
- verified permalink only

## Insights

- real metrics
- period selection where supported
- comparison with valid data
- missing/unavailable metric handling
- provider errors

## Engagement

- selected post context
- replies loaded
- empty replies
- unsupported capability
- authorization error

## Audit

- safe event rendering
- sensitive fields excluded
- pagination/bounds if applicable

## Security regression

Explicitly test that secrets and tokens remain absent from:

- API responses
- rendered HTML
- client bundles where practical
- audit records
- ordinary logs

## Regression

Run the complete Phase 1–3 test suite.

---

# 12. ACCESSIBILITY

Improve practical accessibility without turning Phase 4 into a separate design project.

At minimum:

- form controls have labels
- buttons have clear names
- focus states remain visible
- errors are understandable
- loading states are communicated
- status messages are not color-only
- interactive elements are keyboard reachable
- tables/lists have sensible semantics where used

---

# 13. DOCUMENTATION UPDATES

Update documentation where the implementation changes the actual product behavior.

At minimum review:

- `README.md`
- `docs/03_UX_UI_BLUEPRINT.md`
- `docs/04_API_INTEGRATION_CONTRACT.md` if provider behavior changes
- `docs/06_TESTING_AND_DELIVERY.md`
- `docs/07_ROADMAP_AND_PHASES.md`

Document only verified behavior.

Update Phase 4 status only according to the acceptance gate below.

---

# 14. STRICT NON-GOALS

Do not implement:

- AI content generation as a required publishing path
- automated replies
- automated comments
- automated likes/reactions
- DMs
- bulk engagement
- mass publishing
- scheduling unless already explicitly supported by the existing product contract
- Instagram
- Facebook
- TikTok
- Make.com
- multi-user authentication
- tenant management
- demand intelligence
- opportunity database
- lead scoring
- autonomous operator behavior
- hidden/background actions

Phase 4 is the **operator polish layer**.

---

# 15. IMPLEMENTATION DISCIPLINE

1. Inspect the current implementation before modifying it.
2. Preserve Phase 1–3 functionality.
3. Prefer small, reversible changes.
4. Reuse existing components and services.
5. Do not perform a framework rewrite.
6. Do not expose credentials for convenience.
7. Do not add fake data.
8. Do not add unsupported provider functionality.
9. Keep provider communication server-side.
10. Keep API calls bounded.
11. Run the complete test suite.
12. Run typecheck.
13. Run production build.
14. Report blockers honestly.

---

# 16. DEFINITION OF DONE

Phase 4 is implementation-complete when:

- Dashboard is materially more useful as an operator home.
- Posts can be searched/filtered/sorted within reasonable data bounds.
- Post detail provides useful real context.
- Engagement is contextual and honest about API limitations.
- Insights are easier to interpret using only supported metrics.
- Safe operational activity/audit visibility exists where appropriate.
- Loading/empty/error/unsupported/reauthorization states are consistent.
- Accessibility basics are covered.
- Performance remains reasonable.
- No secrets/tokens are exposed.
- Phase 1–3 functionality remains intact.
- Tests pass.
- Typecheck passes.
- Production build passes.
- Documentation reflects the implementation.

---

# 17. PHASE 4 ACCEPTANCE GATE

## PASS

Mark Phase 4 `PASS` when:

1. The existing Threads connection still works.
2. Existing read functionality still works.
3. Existing publish functionality still works where previously verified.
4. Dashboard is useful with real data.
5. Posts are materially easier to operate.
6. Post detail works with real data.
7. Engagement/insights states are truthful.
8. No fake metrics or records were introduced.
9. Security regression checks pass.
10. Tests pass.
11. Typecheck passes.
12. Production build passes.
13. No Phase 5/future integrations were introduced.

## BLOCKED

Mark Phase 4 `BLOCKED` if implementation is complete but an external dependency prevents real verification, such as:

- production credentials unavailable
- Threads account unavailable
- required API permission unavailable
- provider/API outage
- App Review/tester restriction affecting verification

In that case distinguish clearly between:

- `IMPLEMENTATION COMPLETE`
- `REAL-WORLD VERIFICATION BLOCKED`

Do not call the gate PASS merely because mocked/unit tests pass.

---

# 18. FINAL GENSPARK REPORT FORMAT

Return a concise report with exactly these sections:

## 1. IMPLEMENTED

List completed Phase 4 capabilities.

## 2. FILES / MODULES CHANGED

List important files and why.

## 3. CURRENT THREADS API CONTRACT USED

State only provider behavior actually verified or reused.

## 4. UX / OPERATOR IMPROVEMENTS

Summarize the practical workflow improvements.

## 5. SECURITY CHECK

Confirm what was verified about secrets/tokens/auth payloads.

## 6. TESTS / TYPECHECK / BUILD

Report exact results.

## 7. REAL ACCOUNT VERIFICATION

State what was verified with a real connected Threads account and what was blocked.

## 8. LIMITATIONS / EXTERNAL BLOCKERS

List only real blockers.

## 9. PHASE 4 GATE

Return exactly one of:

- `PASS`
- `BLOCKED`

If blocked, explain why and what remains.

---

# 19. FINAL INSTRUCTION

**GAS PHASE 4 ONLY.**

Build a polished, practical operator console on top of the existing Threads Tools foundation.

Do not turn this into an API tester.
Do not expose secrets.
Do not invent API capabilities.
Do not add automation, AI agents, Instagram, Make.com, DMs, demand intelligence, or future-phase features.

Preserve the real working foundation and make the operator experience significantly better.
