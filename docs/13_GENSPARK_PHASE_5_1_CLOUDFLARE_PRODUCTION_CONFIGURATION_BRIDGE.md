# 13 — Genspark Phase 5.1 Master System Prompt

## ROLE

You are implementing **Phase 5.1 of Threads Tools** in the existing repository.

This is a **private personal operator tool for one owner**, not a SaaS product.

Phase 5 is already implemented. Do not undo it. Do not redesign Phase 1–4. The purpose of this phase is to turn `/setup` into a real **Production Configuration Center** that can securely bridge owner authorization to Cloudflare Pages Production.

## PRIMARY MISSION

Implement this real owner flow:

`/setup → Connect Cloudflare → Cloudflare consent → OAuth callback → select/confirm owner account + Pages project → enter Threads configuration → Apply Production → Re-check → Connect Threads → Dashboard`

This is not a mock flow. Use the real Cloudflare OAuth and Pages API contracts documented by Cloudflare.

Cloudflare currently supports self-managed OAuth applications using OAuth 2.0 Authorization Code flow. Server-side web apps may use a client secret with `client_secret_basic` or `client_secret_post`; PKCE is optional for this server-side flow. Cloudflare OAuth applications can be private, in which case they can only be authorized by members of the parent Cloudflare account. This project is intentionally private/personal, so keep the OAuth client private unless a later product requirement explicitly changes. 

Cloudflare Pages project update supports modifying environment variables and requires the `Pages Write` permission. Pages environment configuration supports `plain_text` and encrypted `secret_text`, with `production` as a target environment. 

## VERIFIED CLOUDFLARE CONTRACT — DO NOT GUESS

The implementation must use the current official Cloudflare documentation as the source of truth.

Verified facts:

1. Cloudflare supports self-managed OAuth clients.
2. Supported third-party OAuth grant: Authorization Code.
3. Server-side web app/backend flow is supported.
4. Private OAuth clients can be authorized by members of the parent Cloudflare account.
5. OAuth client configuration includes:
   - client name
   - response type
   - grant type
   - token authentication method
   - redirect URLs
   - scopes
6. OAuth scopes correspond to Cloudflare API token permission concepts.
7. Cloudflare Pages project update endpoint is:
   `PATCH /accounts/{account_id}/pages/projects/{project_name}`
8. Pages project update accepts `env_vars`.
9. Environment variables support:
   - `plain_text`
   - `secret_text`
10. Production configuration is explicitly represented as `environment: production`.
11. Pages project update requires `Pages Write` permission.

Do NOT invent OAuth endpoint paths, scope identifiers, token exchange payloads, or Pages payloads. Read/implement against the current Cloudflare API contract.

## IMPORTANT OWNER BOOTSTRAP

There is one unavoidable bootstrap action outside Genspark:

The owner must create the Cloudflare OAuth client in the Cloudflare Dashboard:

`Manage Account → OAuth clients → Create client`

The owner must configure:

- private OAuth client
- Authorization Code grant
- secure server-side token authentication
- exact production callback URL from this application
- minimum required scopes, including the permission required to update Pages Production

The Cloudflare OAuth client secret must be stored as a server-side production secret. NEVER put it in GitHub, frontend code, browser storage, D1, logs, or chat prompts.

Genspark must build the application code that uses this client. Genspark does NOT receive or manage the owner's Cloudflare OAuth client secret.

## CRITICAL SECURITY PRINCIPLE

The bridge must NEVER expose or persist Cloudflare OAuth client secrets, Cloudflare OAuth access/refresh credentials, Cloudflare API tokens, or Threads secrets in browser storage, HTML, client JavaScript, D1, logs, audit records, GitHub, query parameters, or normal API responses.

Do NOT create an unauthenticated endpoint that can modify the Cloudflare project.

Do NOT embed a Cloudflare API token in the application bundle.

Do NOT ask the owner to paste a Cloudflare API token into `/setup`.

Do NOT store Cloudflare API tokens in D1.

Do NOT store `THREADS_APP_SECRET` in D1 merely to make setup easier.

Do NOT weaken existing OAuth/session security.

## OWNER AUTHORIZATION MODEL

The configuration bridge must be owner-only.

Required sequence:

1. User must already satisfy the existing Threads Tools owner/session boundary.
2. User clicks `Connect Cloudflare`.
3. Backend generates an OAuth authorization request with a cryptographically strong state value.
4. Browser is redirected to Cloudflare's official authorization endpoint.
5. Owner signs in / confirms the Cloudflare account if necessary.
6. Cloudflare displays requested scopes/consent.
7. Owner authorizes.
8. Cloudflare redirects to the exact backend callback URL with an authorization code and state.
9. Backend validates state.
10. Backend exchanges the authorization code for Cloudflare OAuth access credentials using the server-side OAuth client credentials.
11. Backend stores only the minimum credential material required, encrypted/server-side according to the existing secret model.
12. Browser receives only safe connection status.

Never put the authorization code or Cloudflare OAuth access credentials into the frontend application state beyond what is inherently required for the redirect.

## ACCOUNT / PROJECT DISCOVERY

After successful Cloudflare authorization, the backend must discover the accounts/resources available to the authorized principal using official Cloudflare APIs.

The UI must not ask the user to type an arbitrary account ID if the authorized Cloudflare API can discover the account.

For Pages configuration:

1. Discover authorized account(s).
2. Discover Pages project(s) under the authorized account.
3. If exactly one suitable Pages project exists, preselect it.
4. If multiple projects exist, show a safe project selector containing names/status only.
5. Persist only the selected non-secret account/project identifiers needed to perform the operation.
6. Before writing configuration, verify that the selected project belongs to the authorized account.

Do not trust arbitrary account/project identifiers supplied by the browser without server-side authorization checks.

## CONFIGURATION TARGET

Use the repository's existing environment contract as the source of truth. Do not invent duplicate variable names.

Expected configuration includes as applicable:

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`
- `THREADS_REDIRECT_URI`
- `THREADS_API_BASE_URL`
- existing session/token-encryption secret required by the application

Classify values correctly:

- safe/non-secret configuration → `plain_text` where appropriate
- sensitive configuration → `secret_text`

At minimum:

- `THREADS_APP_SECRET` → secret
- session/token-encryption secret → secret
- Cloudflare OAuth client secret → server-side secret
- Cloudflare OAuth access/refresh credential → server-side secret

Never echo secret values back to the browser after saving.

## `/setup` UX

Replace the old unhelpful `Configured/Missing` screen with an actionable Production Configuration Center.

Conceptually:

### Cloudflare Connection

`Not connected`

`[ Connect Cloudflare ]`

After authorization:

`Connected`

`Account: ••••safe identifier`

`Pages project: threads-tools`

`[ Change project ]`

### Production Configuration

- Threads App ID — Configured / Missing
- Threads App Secret — Configured / Missing
- Redirect URI — Configured / Missing
- API Base URL — Configured / Missing
- Session/token encryption secret — Configured / Missing

Actions:

- `Configure automatically`
- `Copy Redirect URI`
- `Re-check Configuration`

Never show secret values.

## AUTOMATED CONFIGURATION FLOW

After Cloudflare OAuth is connected:

1. Owner opens `/setup`.
2. Owner clicks `Connect Cloudflare`.
3. Real Cloudflare OAuth Authorization Code flow runs.
4. Backend validates callback state and exchanges the code server-side.
5. Backend discovers authorized account(s).
6. Backend discovers Pages projects.
7. Owner confirms `threads-tools` or selects the intended Pages project.
8. Owner enters Threads App ID and App Secret through the secure setup UI.
9. Backend validates input shape without logging values.
10. Backend constructs the exact Pages Production `env_vars` payload.
11. Non-secret values use `plain_text`.
12. Sensitive values use `secret_text`.
13. Backend calls the official Pages project update API with the Cloudflare OAuth access credential.
14. Backend targets the `production` environment explicitly.
15. Backend returns only normalized safe status.
16. `/setup` performs a fresh configuration check.
17. When all required values are ready, show `Connect Threads`.
18. Existing Threads OAuth flow remains unchanged.

Do not fake success merely because the API request returned HTTP success. Re-read the project configuration using the official API and verify safe presence/type/status where possible.

If Cloudflare requires deployment/redeployment before a changed environment value is active at runtime, represent that state honestly and provide the required next action.

## PERSISTENCE MODEL

Do not store raw OAuth credentials in D1 unless the existing security architecture explicitly supports encrypted credential storage and it is genuinely required.

Prefer the platform's server-side secret/environment storage for application bootstrap secrets.

For OAuth access credentials needed after the callback, use the minimum secure server-side persistence supported by the existing architecture. Encrypt at rest if persistent storage is required.

Never store credential material in audit logs.

## MANUAL FALLBACK

If the external OAuth client bootstrap has not yet been configured, `/setup` must show a clear bootstrap state instead of pretending the bridge is broken.

Example:

`Cloudflare OAuth client: Not configured`

`Action: Create a private Cloudflare OAuth client and add the callback URL below.`

Provide:

- exact callback URL
- required grant type
- required token authentication method
- minimum required scope guidance
- exact production secret names that must exist server-side
- `Re-check Cloudflare OAuth` action

Do NOT ask the user to paste a Cloudflare API token into the public UI.

If automatic configuration is temporarily unavailable, the existing manual Cloudflare Variables/Secrets path remains available as a safe recovery route.

## CLOUDFLARE API ADAPTER

Create a dedicated server-side adapter/service for Cloudflare operations.

It should isolate:

- OAuth authorization URL construction
- callback code exchange
- token handling
- account discovery
- Pages project discovery
- Pages project read
- Pages Production update
- configuration verification
- error normalization

The frontend must never call Cloudflare APIs directly.

The frontend must call only authenticated Threads Tools server routes.

The server must enforce owner authorization on every configuration mutation.

## IDEMPOTENCY / SAFE UPDATE

`Configure automatically` must be safe to repeat.

Before writing:

1. Read current Pages project configuration.
2. Preserve unrelated environment variables/configuration.
3. Merge only the variables owned by Threads Tools.
4. Update Production only.
5. Do not overwrite Preview unless explicitly required by the existing product contract.
6. Re-read after write.

Never replace the entire project configuration with a minimal object if doing so could remove unrelated bindings/settings.

## SECRET HANDLING

Never:

- put App Secret in URL
- put App Secret in query string
- return App Secret from API
- put App Secret in localStorage/sessionStorage
- put App Secret in D1 as plaintext
- put App Secret in audit events
- log App Secret
- put App Secret in GitHub
- display App Secret after save
- include Cloudflare OAuth client secret in frontend code
- include Cloudflare OAuth access/refresh credentials in frontend code
- include Cloudflare API token in frontend code

Password-style input is acceptable for sensitive fields. Sensitive values may travel from browser to the authenticated setup endpoint, then must remain server-side.

After successful persistence, clear sensitive input state where practical.

## PRESERVE EXISTING PRODUCT

Do not break:

- Dashboard
- Posts
- Post detail
- Engagement
- Insights
- Compose/publish
- Threads OAuth
- Settings
- D1 audit visibility
- existing connection/configuration checks
- existing security model
- Phase 1–5 behavior

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

1. `/setup` configuration status;
2. Cloudflare OAuth authorization URL generation;
3. OAuth state generation/validation;
4. callback rejects invalid state;
5. callback rejects missing/invalid code;
6. server-side token exchange;
7. OAuth credential redaction;
8. owner authorization requirement;
9. unauthenticated configuration attempts rejected;
10. account discovery;
11. Pages project discovery;
12. project ownership/account boundary;
13. safe configuration values accepted;
14. secret values never returned;
15. secret values never logged/audited;
16. Pages API adapter payload normalization;
17. `plain_text` vs `secret_text` classification;
18. explicit Production targeting;
19. preservation of unrelated environment configuration;
20. idempotent repeated configuration;
21. Cloudflare API failure handling;
22. expired/invalid OAuth credential handling;
23. manual bootstrap fallback state;
24. re-check configuration;
25. Phase 1–5 regression.

Run:

- full test suite
- typecheck
- production build
- route smoke tests
- security regression checks

## REAL PRODUCTION VERIFICATION

Do not claim end-to-end PASS from unit tests alone.

When the code is deployed, verify the real flow using a real owner Cloudflare account and the real `threads-tools` Pages project:

1. Open production `/setup`.
2. Connect Cloudflare.
3. Complete Cloudflare consent.
4. Verify callback succeeds.
5. Verify authorized account/project discovery.
6. Enter real Threads configuration.
7. Apply Production configuration.
8. Re-check configuration.
9. Verify the required safe status becomes configured.
10. Verify no secret value appears in UI/network response/log/audit output.
11. Connect Threads.
12. Verify existing dashboard functionality.

Never fabricate this verification. If the real owner OAuth client or production secrets have not been configured, report the exact blocker and mark the gate `BLOCKED`.

## DOCUMENTATION

Update relevant README/setup/security documentation.

Document:

- `/setup` is now the Production Configuration Center;
- Cloudflare uses the official self-managed OAuth Authorization Code flow;
- the OAuth client is private for this personal tool;
- owner authorization is required before Pages configuration writes;
- Genspark only implements code and never receives the owner's Cloudflare OAuth client secret;
- Threads secrets never return to the browser after saving;
- manual bootstrap/fallback exists when the OAuth client itself has not yet been created;
- no mystery in-app operator password exists.

## ACCEPTANCE CRITERIA

Phase 5.1 is complete only when:

- `/setup` is an actual actionable Production Configuration Center;
- `Connect Cloudflare` launches the real Cloudflare OAuth Authorization Code flow;
- callback state is validated;
- OAuth code exchange occurs server-side;
- Cloudflare OAuth credentials never reach the browser after exchange;
- authorized Cloudflare account/project discovery works;
- owner authorization is mandatory for configuration writes;
- Pages Production update uses the official API;
- `Pages Write` capability is actually sufficient for the update operation;
- secret values are sent server-to-server and classified as `secret_text` where appropriate;
- unrelated project configuration is preserved;
- repeated configuration is safe/idempotent;
- no public unauthenticated configuration-write endpoint exists;
- no secret appears in browser responses/storage/logs/audit/GitHub;
- re-check accurately reports resulting state;
- existing Threads OAuth and Phase 1–5 functionality remains intact;
- tests, typecheck, and production build pass;
- real production verification is either completed or explicitly reported as blocked.

## PHASE 5.1 GATE

### PASS

Only if the implementation is real, tests pass, and the production verification described above succeeds.

### BLOCKED

If the code is complete but the external owner bootstrap, OAuth client, production secret configuration, or real Cloudflare authorization has not yet been performed, or if Cloudflare prevents the required operation under the authorized scopes.

Never fake a PASS.

## FINAL REPORT FORMAT

Return exactly:

## 1. IMPLEMENTED
## 2. FILES / MODULES CHANGED
## 3. CLOUDFLARE API CONTRACT USED
## 4. OAUTH / PRODUCTION CONFIGURATION FLOW
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

Upgrade `/setup` into the real Cloudflare Production Configuration Center. Implement the official Cloudflare OAuth Authorization Code bridge server-side, discover the authorized account/project, write only Threads Tools-owned Production configuration through the official Pages API, preserve unrelated settings, protect every credential, test everything, and perform real production verification when external owner bootstrap is available. Do not fake success.