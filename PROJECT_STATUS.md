# Project status

## Current day

Day 1 — Project foundation. Implemented and verified on 19 Nov 2026.

## Completed tasks

- pnpm workspace and Turborepo are in place for `apps/web`, `apps/api`, `apps/worker`, `packages/database`, `packages/shared`, and `packages/config`.
- Docker Compose runs PostgreSQL 17 and Redis 7. Both containers reported healthy.
- Prisma 7 schema is migrated. Tables: `users`, `scans`, `network_requests`, `network_responses`, `request_timings`. Foreign keys cascade on delete.
- Fastify serves `GET /api/v1/health`.
- The worker process publishes `netskope:worker:heartbeat` and removes it on shutdown. It does not launch a browser.
- The web app renders that health report.
- `pnpm typecheck`, `pnpm test` (6 tests), and `pnpm lint` passed.
- Live check: health returned `postgres: up`, `redis: up`, `worker: up`. Deleting the heartbeat made `worker` `down` without failing the API, and the next beat restored it. `http://localhost:3010` returned 200 and showed all four services up.

## Pending tasks

- Day 2: registration, login, password hashing, scan creation, BullMQ, and a worker that acknowledges a job. No browser until that queue path works.
- SSRF protection before any endpoint accepts a URL.
- Application Docker images (Day 14).

## Known bugs

- None.

## Architectural decisions

- The API and the worker are separate processes. The worker has no HTTP server. Liveness is a Redis key with a 15 second TTL, refreshed every 5 seconds.
- API health stays `ok` when only the worker is down. Postgres or Redis being down returns 503. Scan creation, once it exists, will refuse work when the worker key is missing.
- Request correlation key is `(scan_id, request_id)` where `request_id` is the Chrome DevTools Protocol id. Redirect hops that reuse that id go in `redirect_chain`.
- Timing columns are nullable. Unavailable measurements stay NULL, not zero.
- Response bodies are not stored in relational columns. `response_payload_reference` is reserved for an external object.
- `scans.error_message` records why a scan failed.
- Host ports are 3010 (web), 3011 (API), 5434 (Postgres), and 6380 (Redis) because 3000, 3001, 5432, and 6379 were already taken on this machine. Container-internal Postgres and Redis ports are unchanged.
- Shared package imports are extensionless so Next.js Turbopack can compile the TypeScript source.
- pnpm is allowed to run build scripts for `prisma`, `@prisma/engines`, and `esbuild`. Without that, `pnpm install` cannot download the Prisma engines.

## Next implementation steps

Day 2 only: users can register and log in, create a scan row, and enqueue a BullMQ job that the worker marks as received. Do not add Playwright in that step.
