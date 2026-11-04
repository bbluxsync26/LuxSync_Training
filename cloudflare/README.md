# LuxSync Training progress service

This directory contains the authenticated progress backend for the LuxSync Training site.

## Architecture

- GitHub Pages continues to serve the static training interface.
- Cloudflare Access authenticates every request to luxsync.xyz.
- A Worker route handles only luxsync.xyz/api/*.
- The Worker reads the authenticated Access identity from ctx.access.
- D1 stores progress separately for each unique @luxsync.net identity.
- The direct GitHub Pages URL remains local-only and cannot reach the production progress API.

## Cloudflare setup

1. In Workers & Pages, create a D1 database named luxsync-training.
2. Open its Console and execute schema.sql.
3. Create a Worker using src/index.js.
4. Add a D1 binding named DB and select luxsync-training.
5. Add the route luxsync.xyz/api/* for the luxsync.xyz zone.
6. Disable the workers.dev route.
7. Ensure the existing Cloudflare Access application covers luxsync.xyz/* and allows the LuxSync email policy.
8. Deploy and test https://luxsync.xyz/api/health after completing an Access login.

For Wrangler deployment, copy wrangler.toml.example to wrangler.toml, replace the database ID, authenticate Wrangler, and deploy.

## Security decisions

- The browser never submits an email address as proof of identity.
- The Worker requires ctx.access and rejects non-@luxsync.net identities.
- The workers.dev route is disabled to prevent bypassing the Access-protected custom domain.
- API responses are not cached.
- Progress payloads are type-filtered and size-limited.
- SQL uses bound parameters.
- Existing browser progress is not silently assigned to a user. A learner must explicitly import it from the Learning Record panel.

## Current endpoints

- GET /api/health
- GET /api/me
- GET /api/progress
- PUT /api/progress
- GET /api/simulator-attempts
- POST /api/simulator-attempts
- GET /api/quiz-attempts
- POST /api/quiz-attempts
