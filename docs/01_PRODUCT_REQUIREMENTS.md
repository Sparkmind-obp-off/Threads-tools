# 01 — Product Requirements

## Vision

Threads Tools is a small, real operational console for the user's Threads professional/personal brand. It should help the user publish, read available account activity, and understand response signals without requiring a separate API tester.

## Primary user

One account owner/operator. Multi-user collaboration is out of scope for the first release.

## Core jobs

1. Connect the Threads account safely.
2. Compose and publish a post.
3. Browse the account's available posts and engagement.
4. Inspect comments/replies where the API permits it.
5. Inspect available insights.
6. Clearly distinguish supported, unavailable, and failed API capabilities.

## Non-goals

- Full social-media management suite.
- Automated spam/reply engine.
- Multi-tenant SaaS in v1.
- Combining professional brand content with private daily-life activity.
- Pretending an endpoint exists when the current Meta/Threads API does not expose it.

## Success criteria

A user can connect an account, publish a real post, return to the dashboard, and inspect real available account/post data. Secrets never reach client-side code or Git.
