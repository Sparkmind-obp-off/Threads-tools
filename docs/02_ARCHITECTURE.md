# 02 — Architecture

## Principle

Use a thin server-side integration layer between the UI and Meta/Threads APIs. The UI never receives the App Secret.

```text
Browser
  |
  v
Threads Tools Web App
  |        |
  |        +--> local app state / normalized data
  v
Server API
  |
  +--> OAuth / token handling
  +--> Threads API client
  |
  v
Meta / Threads
```

## Logical modules

- `auth`: OAuth start, callback, token lifecycle.
- `threads`: API client and endpoint adapters.
- `posts`: list/read/create/publish operations.
- `engagement`: comments/replies available to the connected account.
- `insights`: metrics exposed by supported endpoints.
- `dashboard`: normalized UI data.
- `config`: environment validation.
- `audit`: safe operational logs without tokens or sensitive payloads.

## Data rule

Normalize provider responses at the server boundary. The UI should consume stable application objects instead of raw Graph API response shapes.

## Capability rule

Every feature must have a capability state: `supported`, `unsupported`, `not_configured`, or `error`. This prevents fake functionality when an API permission/endpoint is unavailable.

## Storage

Start with the minimum persistent state required for OAuth/token management and optional cached metadata. Do not store raw private messages or unnecessary personal data by default.
