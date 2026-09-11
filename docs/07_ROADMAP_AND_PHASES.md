# 07 — Roadmap and Phase Gates

## Phase 0 — Foundation

Documentation, repository hygiene, environment contract, and architecture.

**Status:** implemented.

## Phase 1 — Connection

OAuth, secure server configuration, encrypted token persistence, account status, and safe errors.

**Gate:** a real Threads account connects successfully in the configured deployment.

## Phase 2 — Read

Implemented read-only account identity, owned post retrieval, cursor pagination, top-level reply retrieval when permitted, account/post insights when permitted, normalized models, and explicit capability/error/empty states.

**Gate:** the deployed dashboard shows real provider data without raw tester-style payloads and without credential exposure.

**External dependencies:** existing Phase 1 connections must reconnect for Phase 2 scopes. Non-tester/public users require Meta App Review approval and a published app for `threads_read_replies` and `threads_manage_insights`.

## Phase 3 — Publish

Future scope: compose validation, supported media handling, creation container, and publish flow.

**Not implemented in Phase 2.**

## Phase 4 — Operator polish

Future filters, deeper post detail, engagement workflows, metric comparisons, and safe operational audit visibility.

## Phase 5 — Future expansion

Only after Threads Tools is stable: separate personal daily-activity context, other channels such as Instagram, and demand-intelligence features. These remain outside the current product boundary.
