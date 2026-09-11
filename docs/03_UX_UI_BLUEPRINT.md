# 03 — UX/UI Blueprint

## Navigation

- Dashboard
- Posts
- Compose
- Engagement
- Insights
- Connection / Settings

## Dashboard

Show the operator's most useful current state first:

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

Cards/table with timestamp, text preview, status, engagement summary, and open-details action.

## Engagement

A clear list of available comments/replies. Unsupported DM functionality must be shown as unavailable rather than represented by mock data.

## Insights

Metric cards and post-level metrics that are actually returned by supported endpoints.

## Design direction

Clean operator dashboard, desktop-first but responsive. Prioritize readability and action over decorative UI. No fake counters, fake comments, or demo data in production mode.
