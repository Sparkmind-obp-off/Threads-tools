# 13 — Genspark Phase 5.1 Master System Prompt

## ROLE

You are implementing **Phase 5.1 of Threads Tools** in the existing repository.

This is a **private personal operator tool for one owner**, not a SaaS product.

Phase 5 is already implemented. Do not undo it. Do not redesign Phase 1–4. The purpose of this phase is to make production configuration **actionable** instead of showing `Missing` with no useful next step.

## PRIMARY MISSION

Implement a secure **Cloudflare Production Configuration Bridge** for `/setup`.

The desired owner experience is:

`/setup → connect/authorize Cloudflare configuration capability → enter Threads configuration → securely apply to Production → re-check → Connect Threads → Dashboard`

The owner must not be forced to manually hunt through Cloudflare settings for every configuration item when a safe automated path is technically available.

## CRITICAL SECURITY PRINCIPLE

The bridge must NEVER expose or persist Cloudflare API credentials or Threads secrets in browser storage, HTML, client JavaScript, D1, logs, audit records, GitHub, query parameters, or normal API responses.

Do NOT create an unauthenticated endpoint that can modify the Cloudflare project.

Do NOT embed a Cloudflare API token in the application bundle.

Do NOT store a Cloudflare API token in localStorage, sessionStorage, cookies accessible to JavaScript, URL parameters, or D1.

Do NOT store `THREADS_APP_SECRET` in D1 merely to make setup easier.

Do NOT weaken existing OAuth/session security.

## IMPORTANT IMPLEMENTATION DECISION

The bridge may automate Cloudflare configuration only if there is a secure owner authorization mechanism.

Preferred design:

1. `/setup` has a clear **Connect Cloudflare** / **Authorize Cloudflare** step.
2. The owner authorizes the Cloudflare account/project through a supported secure mechanism, preferably OAuth or another server-side authorization flow if Cloudflare provides the required capability for this use case.
3. The resulting authorization is handled server-side and stored only in the minimum secure form required.
4. `/setup` can then call the Cloudflare API server-side to configure the selected Pages project/environment.

If a safe Cloudflare authorization flow cannot be implemented with the currently available Cloudflare APIs, **do not invent one** and do not accept a raw API token through an unauthenticated/public form.

In that case, implement a secure guided fallback:

- `/setup` clearly explains exactly what must be configured in Cloudflare;
- shows the exact variable/secret names;
- provides copy buttons for safe values such as Redirect URI;
- provides a `Re-check Configuration` action;
- clearly distinguishes what can be automated from what requires one-time owner action.

The fallback must still be substantially better than a bare `Missing` label.

## CONFIGURATION TARGET

The Production configuration model should account for the existing Threads Tools environment variables, including as applicable:

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`
- `THREADS_REDIRECT_URI`
- `THREADS_API_BASE_URL`
- existing session/token-encryption secret required by the application

Use the repository's existing environment contract as the source of truth. Do not invent duplicate variable names.

### Classification

Safe non-secret configuration may use normal environment variables where appropriate.

Sensitive values must use Cloudflare encrypted secret configuration (`secret_text`) when managed through the Cloudflare API.

At minimum:

- `THREADS_APP_SECRET` → secret
- session/token-encryption secret → secret
- Cloudflare authorization credential, if any → secret

Never echo secret values back to the browser after saving.

## `/setup` UX

Replace the unhelpful configuration state with an actionable production setup center.

The owner should see something conceptually like:

### Production Configuration

- Threads App ID — Configured / Missing
- Threads App Secret — Configured / Missing
- Redirect URI — Configured / Missing
- API Base URL — Configured / Missing
- Session/token encryption secret — Configured / Missing
- Cloudflare configuration bridge — Connected / Not connected / Manual setup required

For every missing item, provide a clear next action.

Examples:

- `Configure automatically`
- `Connect Cloudflare`
- `Copy Redirect URI`
- `How to configure in Cloudflare`
- `Re-check Configuration`

Do not show secret values.

## AUTOMATED CONFIGURATION FLOW

If secure Cloudflare authorization is available:

1. Owner opens `/setup`.
2. Owner selects **Connect Cloudflare**.
3. Owner completes the supported authorization flow.
4. Server establishes the minimum required Cloudflare capability.
5. Owner enters Threads App ID and App Secret through the secure setup UI.
6. Server validates input shape without logging secret values.
7. Server writes the correct Production Pages variables/secrets through the Cloudflare API.
8. Secret values are sent only server-to-server.
9. Server returns only normalized safe status.
10. `/setup` performs a fresh configuration check.
11. When ready, show **Connect Threads**.

Do not require a redeploy if the Cloudflare API supports changing the relevant environment bindings without one. If a deployment/redeploy is required by the platform, represent that state honestly and provide the appropriate next action.

## MANUAL FALLBACK

If automation cannot safely be completed:

Show an explicit one-time checklist:

1. Open Cloudflare project `threads-tools`.
2. Open Production Variables/Secrets.
3. Add the exact variables from the repository's environment contract.
4. Store sensitive values as encrypted Secrets.
5. Save/deploy as required.
6. Return to `/setup`.
7. Click **Re-check Configuration**.
8. Continue to **Connect Threads** when all required values are configured.

The UI should make this a recovery path, not the only unexplained instruction.

## CLOUDFLARE API REQUIREMENTS

Before implementation, verify the current official Cloudflare API contract for Pages environment variables/secrets.

Use the supported API semantics for:

- Pages project identification
- Production environment configuration
- plain-text variables
- encrypted `secret_text` variables
- update/replace behavior
- required permissions

Do not guess endpoint paths, payload shapes, OAuth scopes, or permission names.

If the current Cloudflare API does not support the required owner authorization flow, stop at the secure manual fallback rather than inventing an insecure mechanism.

## SECRET HANDLING

Never:

- put App Secret in URL
- put App Secret in query string
- return App Secret from API
- put App Secret in localStorage/sessionStorage
- put App Secret in D1
- put App Secret in audit events
- log App Secret
- put App Secret in GitHub
- display App Secret after save
- include Cloudflare API token in frontend code

Input fields may use password-style controls, but the browser must transmit sensitive values only to the intended authenticated server-side setup endpoint.

After successful persistence, clear sensitive input state where practical.

## OWNER AUTHORIZATION

Because this is a private personal operator tool, the Cloudflare configuration bridge must be owner-only.

Do not solve this with the old mystery operator password.

If Cloudflare Access is available/recommended as deployment-level protection, document it as the appropriate private-access layer.

Do not expose a powerful Cloudflare configuration endpoint publicly without an owner authorization boundary.

## PRESERVE EXISTING PRODUCT

Do not break:

- Dashboard
- Posts
- Post detail
- Engagement
- Insights
- Compose/publish
- OAuth
- Settings
- D1 audit visibility
- existing connection/configuration checks
- existing security model
- Phase 1–4 behavior
- Phase 5 onboarding

Do not add:

- SaaS
- multi-user/team/tenant
- billing
- Instagram/Facebook/TikTok
- DMs
- automated engagement
- autonomous AI
- demand intelligence
- opportunity database
- lead scoring
- Make.com
- unrelated integrations

## TESTING

Add tests for:

1. setup configuration status;
2. owner authorization requirement;
3. unauthenticated configuration attempts rejected;
4. safe configuration values accepted;
5. secret values never returned;
6. secret values never logged/audited;
7. Cloudflare API adapter payload normalization;
8. plain-text vs secret-text classification;
9. production environment targeting;
10. Cloudflare API failure handling;
11. invalid/expired Cloudflare authorization;
12. manual fallback state;
13. re-check configuration;
14. Phase 1–5 regression.

Run:

- full test suite
- typecheck
- production build
- route smoke tests
- security regression checks

## DOCUMENTATION

Update the relevant README/setup/security documentation.

Clearly explain:

- `/setup` is the Production Configuration Center;
- automatic Cloudflare configuration requires secure owner authorization;
- secrets are never exposed to the browser after saving;
- if automation is unavailable, the UI provides an explicit manual Cloudflare fallback;
- there is still no mystery in-app operator password.

## ACCEPTANCE CRITERIA

Phase 5.1 is complete only when:

- `/setup` no longer leaves the owner with unexplained `Missing` states;
- every missing production configuration item has an actionable next step;
- a secure Cloudflare bridge is implemented if the current official Cloudflare contract supports it;
- otherwise the manual fallback is clear and complete;
- Cloudflare Production variables/secrets use correct types;
- Threads App Secret is treated as a secret;
- owner authorization is mandatory for configuration writes;
- no public unauthenticated configuration-write endpoint exists;
- no secret appears in browser responses/storage/logs/audit/GitHub;
- re-check accurately reports the resulting state;
- existing Threads OAuth and Phase 1–5 functionality remains intact;
- tests, typecheck, and production build pass.

## PHASE 5.1 GATE

### PASS

Only if the secure automated bridge works end-to-end OR the repository has a complete, explicit, secure manual fallback because the official Cloudflare authorization contract does not permit safe in-app automation.

### BLOCKED

If an external Cloudflare capability is genuinely required and cannot be implemented or safely substituted without weakening security.

Never fake a PASS.

## FINAL REPORT FORMAT

Return exactly:

## 1. IMPLEMENTED
## 2. FILES / MODULES CHANGED
## 3. CLOUDFLARE API CONTRACT USED
## 4. PRODUCTION CONFIGURATION FLOW
## 5. SECURITY CHECK
## 6. TESTS / TYPECHECK / BUILD
## 7. REAL PRODUCTION VERIFICATION
## 8. LIMITATIONS / EXTERNAL BLOCKERS
## 9. PHASE 5.1 GATE

The final gate must be exactly:

`PASS`

or

`BLOCKED`

## FINAL COMMAND

**GAS PHASE 5.1 ONLY.**

Turn `/setup` into a real Production Configuration Center. Prefer a secure Cloudflare configuration bridge when officially supported. Otherwise provide a precise secure fallback. Never expose secrets, never create an unauthenticated Cloudflare configuration endpoint, preserve Phase 1–5, test everything, and stop.