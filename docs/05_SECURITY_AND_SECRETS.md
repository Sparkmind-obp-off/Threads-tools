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
- The Phase 5.1 UI never accepts a raw Cloudflare API token or persists Cloudflare authorization in browser storage, D1, logs, or audit events.
- `/api/configuration/apply` is a deny-only route until a dedicated Cloudflare OAuth client, deployment-level owner authorization, and secure server-side authorization lifecycle are provisioned.

## Repository controls

Required files/configuration should include `.env.example` with placeholders only and `.gitignore` entries for local secrets.

## Production Configuration Center

`/setup` provides safe status, exact binding names and types, the deployment-derived callback URI, an explicit Cloudflare checklist, and a fresh re-check action. It never displays environment values.

Production classification:

- `THREADS_APP_ID`, `THREADS_REDIRECT_URI`, `THREADS_API_BASE_URL`, and `THREADS_API_VERSION`: `plain_text` variables.
- `THREADS_APP_SECRET` and `SESSION_SECRET`: encrypted `secret_text` secrets.

Cloudflare's official API supports `PATCH /accounts/{account_id}/pages/projects/{project_name}` with `deployment_configs.production.env_vars`, and Cloudflare now documents an OAuth Authorization Code flow with Pages Write permission. This deployment uses the secure manual fallback because no dedicated OAuth client or suitable secure server-side credential store has been provisioned. It does not invent an authorization flow or store a powerful Cloudflare credential in D1.

## Privacy

The application is a private personal operator tool for one owner. Collect only data required for the selected features. Avoid retaining private content unless there is a clear product requirement and retention policy. The onboarding completion marker contains only a boolean in browser local storage; no credentials or provider data are stored there.

## Incident response

If a secret is accidentally committed: revoke/rotate it immediately, remove it from active configuration, then clean repository history as appropriate. Never assume deleting the latest file commit makes a leaked secret safe.
