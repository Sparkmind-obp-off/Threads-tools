# 03 — UX/UI Blueprint

## Personal first run

`/setup` provides one short single-owner flow: safe server configuration readiness, current Threads connection state, existing Connect/Reconnect OAuth action, and Continue to Dashboard after connection. Completion is recorded only as a browser-local boolean so it does not repeat unnecessarily; Setup remains available from Settings/header navigation.

There is no registration, organization, team, billing, role, invite, or in-app operator-password step.

## Navigation

- Dashboard
- Posts
- Compose
- Engagement
- Insights
- Connection / Settings
- Review Setup

## Dashboard

Phase 4 presents connection/configuration health, reauthorization warning, direct Compose/Posts actions, and real provider-backed summaries before secondary detail. Show the operator's most useful current state first:

- connected account
- recent posts
- recent engagement available from API
- key available metrics
- quick action: Create post
- API capability warnings/errors

## Compose

Fields:

- text
- optional media, only when the selected API flow supports it
- preview
- Publish
- Save draft (local/server storage only if implemented)

## Posts

Cards/table with timestamp, text preview, media type, verified permalink action, engagement navigation, and open-details action. Search and chronological sort operate only on already-loaded bounded provider pages; the UI labels this boundary and preserves cursor-based Load More.

## Post detail

A dedicated owned-post view shows only returned ID, text, timestamp, permalink, media details, supported insights, and top-level replies. Missing optional fields remain unavailable.

## Engagement

A selected-post context panel and clear list of available top-level replies. The page can open directly for a selected post. Nested replies, reply mutations, and unsupported DM functionality remain explicitly unavailable rather than represented by mock data.

## Insights

Metric cards and post-level metrics that are actually returned by supported endpoints. Phase 4 adds 7/14/30-day current-versus-previous account comparisons for ranged metrics. Followers remain a current snapshot and are excluded from period comparison because Meta does not support `since`/`until` for `followers_count`.

## Activity

Safe, bounded operational history shows only allow-listed connection and publish event metadata: event type, timestamp, outcome, safe resource identifier, and safe error category. It never renders post text, credentials, provider payloads, or authorization material.

## Design direction

Clean operator dashboard, desktop-first but responsive. Prioritize readability and action over decorative UI. No fake counters, fake comments, or demo data in production mode.
