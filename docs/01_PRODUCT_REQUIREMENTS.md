# 01 — Product Requirements

## Vision

Threads Tools is a small, real operational console for the user's Threads professional/personal brand. It should help the user publish, read available account activity, and understand response signals without requiring a separate API tester.

## Primary user

One account owner/operator. Multi-user collaboration is out of scope for the first release.

## Core jobs

1. Complete a short personal first-run readiness check and connect the Threads account safely.
2. Compose and publish a post.
3. Browse the account's available posts and engagement.
4. Inspect comments/replies where the API permits it.
5. Inspect available insights.
6. Clearly distinguish supported, unavailable, and failed API capabilities.

## Non-goals

- Full social-media management suite.
- Automated spam/reply engine.
- Multi-tenant SaaS in v1.
- Separate in-app operator passwords, registration, teams, billing, roles, or invites.
- Combining professional brand content with private daily-life activity.
- Pretending an endpoint exists when the current Meta/Threads API does not expose it.

## Success criteria

The owner can open the app without an unexplained password wall, complete personal setup, connect an account, publish a real post, return to the dashboard, and inspect real available account/post data. Secrets never reach client-side code or Git. Public deployments are protected at the deployment layer.
