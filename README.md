# Threads Tools

A personal Threads operations console for managing a professional/personal-brand presence on Threads.

## Purpose

This project is intentionally **not** a Threads API tester. It is a usable application foundation for one account, with room to evolve into a broader personal content and demand intelligence system.

## Initial scope

- Connect a Threads account through OAuth.
- Read the account's available Threads data.
- Publish Threads posts.
- View available engagement/comment data.
- View available insights/metrics.
- Keep credentials and tokens server-side.
- Make API limitations explicit rather than faking unsupported features.

## Product boundary

Phase 1 focuses on the user's **professional/personal brand activity on Threads**. Personal daily-life activity and future multi-channel activity are separate contexts and are not mixed into the first product model.

## Documentation

See `docs/` for the product, architecture, security, API, UX, testing, deployment, and roadmap documents.

## Security

Never commit `THREADS_APP_SECRET`, access tokens, refresh tokens, or other secrets. Use environment variables/secrets management.

## Status

Foundation/documentation phase. Implementation should follow the contracts in `docs/` rather than turning this repository into another API-response tester.
