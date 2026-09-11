# 05 — Security and Secrets

## Rules

- App Secret is server-only and must be a Cloudflare encrypted Secret (`secret_text`) in Production.
- There is no in-app operator password or password-reset flow.
- A public production URL must be restricted at the deployment layer (recommended: Cloudflare Access) across pages, API routes, and OAuth routes.
- OAuth state is generated, stored/validated, and single-use.
- Tokens are encrypted or stored in the platform's secret/secure storage mechanism when persistence is required.
- Do not log authorization codes, access tokens, refresh tokens, App Secret, cookies, or full private-message payloads.
- Use least-privilege permissions.
- Validate redirect URIs and callback state.
- Sanitize provider errors before displaying them.
- Keep `.env` files out of Git.
- The Phase 5.1 UI never accepts a raw Cloudflare API token or persists Cloudflare authorization in browser storage, logs, audit events, or plaintext storage.
- Every Cloudflare connection, discovery, selection, and Production-write route verifies the signed Cloudflare Access JWT issuer, audience, expiry, signature, and exact `OWNER_EMAIL`.
- OAuth access/refresh credentials are AES-GCM encrypted with `SESSION_SECRET` before D1 persistence; authorization state is stored only as a single-use SHA-256 hash.
- Configuration POST routes additionally require an exact same-origin `Origin` header. Secret values are accepted only by the owner-authorized endpoint, never returned, and cleared from browser input after submission.

## Repository controls

Required files/configuration should include `.env.example` with placeholders only and `.gitignore` entries for local secrets.

## Production Configuration Center

`/setup` is the actionable Production Configuration Center: owner bootstrap, real Cloudflare OAuth consent, authorized account/project discovery and confirmation, secure Threads App ID/App Secret input, Production apply, safe re-check, redeploy guidance, and the existing Threads connection. It never displays saved environment or credential values.

Production classification:

- `THREADS_APP_ID`, `THREADS_REDIRECT_URI`, `THREADS_API_BASE_URL`, and `THREADS_API_VERSION`: `plain_text` variables.
- `THREADS_APP_SECRET` and `SESSION_SECRET`: encrypted `secret_text` secrets.

Cloudflare's official API supports `PATCH /accounts/{account_id}/pages/projects/{project_name}` with `deployment_configs.production.env_vars`. The bridge uses Cloudflare's private self-managed OAuth Authorization Code flow at the documented `dash.cloudflare.com/oauth2/auth` and `/oauth2/token` endpoints with `client_secret_basic`. The owner must create the private client and install `CLOUDFLARE_OAUTH_CLIENT_SECRET` directly as a Production secret; Genspark never receives it. Pages settings are read before the PATCH, unrelated Production variables are preserved, Preview is untouched, and the project is re-read after the update. Manual Cloudflare Variables/Secrets configuration remains the fallback.

## Privacy

The application is a private personal operator tool for one owner. Collect only data required for the selected features. Avoid retaining private content unless there is a clear product requirement and retention policy. The onboarding completion marker contains only a boolean in browser local storage; no credentials or provider data are stored there.

## Incident response

If a secret is accidentally committed: revoke/rotate it immediately, remove it from active configuration, then clean repository history as appropriate. Never assume deleting the latest file commit makes a leaked secret safe.
