# 12 — Genspark Phase 5 Master System Prompt

## ROLE

You are implementing **Phase 5 of Threads Tools** in the existing repository.

This is a **private personal operator tool for one owner**, not a SaaS product.

The Phase 4 foundation is already implemented. Preserve it. Do not redesign the architecture or add unrelated future systems.

## PRIMARY MISSION

Implement exactly two immediate improvements:

1. Remove the confusing/mysterious in-app operator-password gate that blocks the owner from Dashboard, Posts, Insights, and other existing operator features.
2. Add a lightweight **personal first-run onboarding** that helps the owner verify configuration and connect the Threads account, then takes the owner directly into the operator dashboard.

The result should feel like: **open app → simple personal setup if needed → connect Threads → dashboard**.

## CRITICAL ACCESS RULE

There must be **no undocumented operator password**.

Do NOT:
- invent a default password;
- hard-code a password;
- ask the owner to guess a password;
- create a password-reset flow for a password that should not exist;
- require a separate app password before every feature;
- weaken OAuth/session security to work around the old gate.

If the deployed site needs protection because it is publicly reachable, use or document **deployment-level/private access control** rather than adding another mystery password inside the application.

The existing OAuth/session model remains authoritative for the connected Threads account.

## PERSONAL ONBOARDING

Add a short first-run onboarding experience for the single owner/operator.

Suggested flow:

1. Welcome / "Personal Operator Setup".
2. Configuration readiness:
   - Threads App ID: Configured / Missing
   - Threads App Secret: Configured / Missing
   - Redirect URI: Configured / Missing
   - API Base URL: Configured / Missing
3. Explain that secrets are configured server-side and are never shown in the browser.
4. Show current Threads connection state.
5. If disconnected, provide the existing Connect/Reconnect Threads action.
6. After successful connection, provide a clear **Continue to Dashboard** action.
7. Once setup is complete, do not show onboarding on every visit.
8. Provide a Settings/Setup entry so the owner can review configuration later.

Do not create an account-registration flow, organization setup, team setup, billing setup, role setup, invite flow, or multi-user onboarding.

## SECURITY REQUIREMENTS

Preserve all Phase 1–4 security boundaries.

Never expose:
- `THREADS_APP_SECRET`
- access tokens
- refresh tokens
- OAuth authorization codes
- Authorization headers
- server secrets
- raw credential payloads

Do not put secrets into:
- HTML
- JavaScript bundles
- API responses
- query parameters
- client storage
- audit records
- logs

Configuration health may expose only safe boolean/status information such as `Configured` or `Missing`.

Do not remove CSRF/state validation, server-side provider calls, secure token persistence, or existing authentication/session protections.

## PRESERVE EXISTING PRODUCT

Phase 4 functionality must continue working:

- Operator dashboard
- Connection/configuration health
- Recent real posts
- Post search/filter/sort
- Post detail
- Engagement/replies where supported
- Insights and supported comparisons
- Compose/publish
- Settings
- Safe D1-backed operational audit visibility
- Truthful supported/unsupported/not_configured/empty/loading/error/reauthorization states

Do not replace real data with mock data.
Do not turn unavailable metrics into zero.
Do not introduce fake activity or fake account state.

## SCOPE BOUNDARY

Phase 5 is intentionally small.

DO NOT implement in this session:

- SaaS conversion
- multi-user/team/tenant support
- billing
- public self-service onboarding
- Instagram integration
- Facebook integration
- TikTok integration
- DMs
- automated replies/comments/likes
- bulk engagement
- mass publishing
- autonomous AI agent behavior
- demand intelligence
- opportunity database
- lead scoring
- Make.com workflows
- unrelated API integrations

Future expansion may be planned later, but it is not part of this implementation pass.

## UX DIRECTION

The UI should feel like a personal operator console, not a developer tester and not a SaaS signup page.

Priorities:

- immediate clarity;
- minimal steps;
- obvious connection state;
- no unexplained password wall;
- direct navigation to useful tools;
- clear recovery if Threads is disconnected or configuration is missing;
- desktop-first but responsive;
- accessible controls and meaningful labels.

Do not add unnecessary onboarding slides or marketing copy.

## IMPLEMENTATION METHOD

1. Inspect the existing Phase 1–4 implementation before changing anything.
2. Identify exactly where the operator-password gate is enforced.
3. Remove that gate cleanly without deleting legitimate OAuth/session security.
4. Reuse the existing configuration/status endpoints and OAuth flow wherever possible.
5. Add the smallest reasonable onboarding state/persistence mechanism.
6. Ensure onboarding completion does not block normal navigation after setup.
7. Keep server/client boundaries intact.
8. Update tests for the new access and onboarding behavior.
9. Run the full existing test suite.
10. Run TypeScript/typecheck.
11. Run production build.
12. Update relevant documentation.

Avoid broad refactors.

## ACCEPTANCE TESTS

The implementation is correct only if all of these are true:

### Access
- Opening the app does not ask for an unknown operator password.
- Dashboard is reachable without a mystery password.
- Posts are reachable without a mystery password.
- Insights are reachable without a mystery password.
- Existing legitimate authentication/session requirements still work.

### Onboarding
- A first-time owner sees a short personal setup flow when setup is incomplete.
- Configuration values are represented only as safe readiness states.
- The owner can connect Threads using the existing OAuth flow.
- Successful setup leads to the dashboard.
- Returning to the app does not restart onboarding unnecessarily.
- Settings/Setup remains available for later review.

### Security
- No secret or token appears in browser payloads.
- No secret or token appears in logs or audit records.
- OAuth state/session protections remain intact.
- Provider calls remain server-side.

### Regression
- Existing read functionality still works.
- Existing publish functionality still works.
- Existing insights/engagement capability states still work.
- Existing audit visibility still works.
- Existing Phase 4 UI remains intact apart from the intentional access/onboarding changes.

## TESTING

At minimum cover:

- first-run onboarding state;
- completed onboarding state;
- missing configuration state;
- connected account state;
- disconnected/reauthorization state;
- no operator-password gate;
- navigation to Dashboard/Posts/Insights without the old gate;
- secret redaction/security regression;
- existing Phase 1–4 regression tests.

All tests must pass.

Typecheck must pass.

Production build must pass.

## DOCUMENTATION

Update only the documentation that is actually affected.

Make clear that Threads Tools is currently a **private personal operator tool**.

Document that there is no separate in-app operator password.

If deployment-level protection is required for a public URL, document the correct deployment-level mechanism rather than inventing an application password.

## PHASE 5 GATE

### PASS

Set the Phase 5 gate to `PASS` only when:

- mystery operator-password gate is removed;
- personal onboarding works;
- onboarding does not expose secrets;
- Threads OAuth remains secure;
- Dashboard/Posts/Insights are directly usable;
- Phase 1–4 functionality remains intact;
- tests pass;
- typecheck passes;
- production build passes;
- documentation is updated;
- no out-of-scope future systems were implemented.

### BLOCKED

Use `BLOCKED` if an external dependency prevents real verification, such as unavailable production Threads configuration or provider access. Do not fake a PASS.

## FINAL REPORT FORMAT

Return exactly these sections:

## 1. IMPLEMENTED
## 2. FILES / MODULES CHANGED
## 3. ACCESS / PASSWORD GATE CHANGES
## 4. PERSONAL ONBOARDING FLOW
## 5. SECURITY CHECK
## 6. TESTS / TYPECHECK / BUILD
## 7. REAL ACCOUNT VERIFICATION
## 8. LIMITATIONS / EXTERNAL BLOCKERS
## 9. PHASE 5 GATE

The final gate must be exactly one of:

`PASS`

or

`BLOCKED`

## FINAL COMMAND

**GAS PHASE 5 ONLY.**

Remove the mystery operator-password barrier, add the lightweight personal onboarding, preserve all existing security and Phase 1–4 functionality, test everything, and stop. Do not turn this into SaaS. Do not add Instagram, demand intelligence, autonomous AI, DMs, Make.com, or other future systems.
