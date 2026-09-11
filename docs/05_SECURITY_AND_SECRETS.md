# 05 — Security and Secrets

## Rules

- App Secret is server-only.
- There is no in-app operator password or password-reset flow.
- A public production URL must be restricted at the deployment layer (recommended: Cloudflare Access) across pages, API routes, and OAuth routes.
- OAuth state is generated, stored/validated, and single-use.
- Tokens are encrypted or stored in the platform's secret/secure storage mechanism when persistence is required.
- Do not log authorization codes, access tokens, refresh tokens, App Secret, cookies, or full private-message payloads.
- Use least-privilege permissions.
- Validate redirect URIs and callback state.
- Sanitize provider errors before displaying them.
- Keep `.env` files out of Git.

## Repository controls

Required files/configuration should include `.env.example` with placeholders only and `.gitignore` entries for local secrets.

## Privacy

The application is a private personal operator tool for one owner. Collect only data required for the selected features. Avoid retaining private content unless there is a clear product requirement and retention policy. The onboarding completion marker contains only a boolean in browser local storage; no credentials or provider data are stored there.

## Incident response

If a secret is accidentally committed: revoke/rotate it immediately, remove it from active configuration, then clean repository history as appropriate. Never assume deleting the latest file commit makes a leaked secret safe.
